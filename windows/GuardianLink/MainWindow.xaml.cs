using System;
using System.Windows;
using System.Windows.Threading;

namespace GuardianLink;

public partial class MainWindow : Window
{
    private readonly Store store = new();
    private readonly DispatcherTimer timer = new() { Interval = TimeSpan.FromSeconds(60) };

    public MainWindow()
    {
        InitializeComponent();
        NameBox.Text = Environment.MachineName;
        timer.Tick += async (_, _) => await TickAsync();
        if (store.Load() is not null) ShowStatus();
    }

    private async void Join_Click(object s, RoutedEventArgs e)
    {
        Msg.Text = "";
        if (Consent.IsChecked != true || CodeBox.Text.Length != 8) { Msg.Text = "Enter the 8-character code and tick the consent box."; return; }
        try { store.Save(await Api.EnrollAsync(CodeBox.Text, NameBox.Text)); ShowStatus(); }
        catch (Exception ex) { Msg.Text = ex.Message; }
    }

    private async void Leave_Click(object s, RoutedEventArgs e)
    {
        var d = store.Load();
        if (d is not null) { try { await Api.LeaveAsync(d); } catch { /* still leave locally */ } }
        store.Clear(); timer.Stop();
        StatusPanel.Visibility = Visibility.Collapsed; JoinPanel.Visibility = Visibility.Visible;
    }

    private void ShowStatus()
    {
        JoinPanel.Visibility = Visibility.Collapsed; StatusPanel.Visibility = Visibility.Visible;
        timer.Start(); _ = TickAsync();
    }

    private async System.Threading.Tasks.Task TickAsync()
    {
        var d = store.Load(); if (d is null) return;
        try
        {
            await Api.TelemetryAsync(d, Battery.Percent());
            foreach (var c in await Api.CommandsAsync(d))
                if (c.type == "lock") { LockWorkStation(); await Api.AckAsync(d, c.id); }
            StatusText.Text = $"Connected. Last update {DateTime.Now:t}.";
        }
        catch (UnauthorizedAccessException) { store.Clear(); timer.Stop(); StatusPanel.Visibility = Visibility.Collapsed; JoinPanel.Visibility = Visibility.Visible; Msg.Text = "Your organiser removed this device."; }
        catch (Exception ex) { StatusText.Text = "Offline: " + ex.Message; }
    }

    [System.Runtime.InteropServices.DllImport("user32.dll")] private static extern bool LockWorkStation();
}
