using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

namespace GuardianLink;

public record Device(long Id, string Key);

/// <summary>Per-device key stored with Windows DPAPI (current user scope).</summary>
public class Store
{
    private static readonly string PathName = System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "GuardianLink", "device.bin");
    public Device? Load()
    {
        try { return JsonSerializer.Deserialize<Device>(Encoding.UTF8.GetString(ProtectedData.Unprotect(File.ReadAllBytes(PathName), null, DataProtectionScope.CurrentUser))); }
        catch { return null; }
    }
    public void Save(Device d)
    {
        Directory.CreateDirectory(System.IO.Path.GetDirectoryName(PathName)!);
        File.WriteAllBytes(PathName, ProtectedData.Protect(JsonSerializer.SerializeToUtf8Bytes(d), null, DataProtectionScope.CurrentUser));
    }
    public void Clear() { try { File.Delete(PathName); } catch { } }
}

public static class Api
{
    // Set at install time in %ProgramFiles%\GuardianLink\server.txt (https only).
    private static readonly string Base = File.ReadAllText(System.IO.Path.Combine(AppContext.BaseDirectory, "server.txt")).Trim().TrimEnd('/');
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(15) };

    static Api() { if (!Base.StartsWith("https://")) throw new InvalidOperationException("server.txt must contain an https:// URL"); }

    private static HttpRequestMessage Req(HttpMethod m, string path, Device? d, object? body)
    {
        var r = new HttpRequestMessage(m, Base + path);
        if (d is not null) { r.Headers.Add("X-Device-Id", d.Id.ToString()); r.Headers.Add("X-Device-Key", d.Key); }
        if (body is not null) r.Content = JsonContent.Create(body);
        return r;
    }
    private static async Task<JsonElement> Send(HttpRequestMessage r)
    {
        var resp = await Http.SendAsync(r);
        var text = await resp.Content.ReadAsStringAsync();
        if (resp.StatusCode == System.Net.HttpStatusCode.Unauthorized && r.Headers.Contains("X-Device-Key")) throw new UnauthorizedAccessException();
        var doc = text.Length > 0 ? JsonDocument.Parse(text).RootElement : default;
        if (!resp.IsSuccessStatusCode) throw new Exception(doc.ValueKind == JsonValueKind.Object && doc.TryGetProperty("error", out var e) ? e.GetString() : $"HTTP {(int)resp.StatusCode}");
        return doc;
    }

    public static async Task<Device> EnrollAsync(string code, string name)
    {
        var j = await Send(Req(HttpMethod.Post, "/api/devices/enroll", null, new { code, name, platform = "windows", consent = true }));
        return new Device(j.GetProperty("deviceId").GetInt64(), j.GetProperty("deviceKey").GetString()!);
    }
    public static Task TelemetryAsync(Device d, int? battery) => Send(Req(HttpMethod.Post, "/api/device/telemetry", d, battery is null ? new { } : new { battery }));
    public static async Task<List<(long id, string type)>> CommandsAsync(Device d)
    {
        var j = await Send(Req(HttpMethod.Get, "/api/device/commands", d, null));
        var l = new List<(long, string)>();
        foreach (var c in j.GetProperty("commands").EnumerateArray()) l.Add((c.GetProperty("id").GetInt64(), c.GetProperty("type").GetString()!));
        return l;
    }
    public static Task AckAsync(Device d, long id) => Send(Req(HttpMethod.Post, $"/api/device/commands/{id}/ack", d, new { }));
    public static Task LeaveAsync(Device d) => Send(Req(HttpMethod.Post, "/api/device/leave", d, new { }));
}

public static class Battery
{
    public static int? Percent()
    {
        var s = System.Windows.Forms.SystemInformation.PowerStatus; // requires UseWindowsForms
        return s.BatteryLifePercent is >= 0f and <= 1f ? (int)Math.Round(s.BatteryLifePercent * 100) : null;
    }
}
