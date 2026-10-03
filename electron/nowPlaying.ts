import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { NOTHING_PLAYING, NOW_PLAYING_COMMANDS, parseNowPlaying, type NowPlaying, type NowPlayingCommand } from '../src/shared/nowplaying';

// What's playing anywhere on the computer, from Windows' own media controls
// (the box that pops up with the volume keys). Windows lets any app read it
// through its "System Media Transport Controls"; a small PowerShell script,
// started hidden, watches it and takes play, pause, skip and shuffle commands.
// Nothing to install, and nothing leaves the computer.

/**
 * The PowerShell side. Prints one line of JSON whenever something changes
 * (and every second while a song plays, for the progress bar), and reads one
 * command per line: toggle, next, prev, shuffle.
 */
export const HELPER_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation${'`'}1'
} | Select-Object -First 1
function Await($op, [Type]$type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  if (-not $task.Wait(4000)) { return $null }
  return $task.Result
}
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
$ManagerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$PropsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
$StreamType = [Windows.Storage.Streams.IRandomAccessStreamWithContentType]
$Playing = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackStatus]::Playing
$manager = Await ($ManagerType::RequestAsync()) $ManagerType

function Thumb($ref) {
  try {
    if ($null -eq $ref) { return '' }
    $stream = Await ($ref.OpenReadAsync()) $StreamType
    if ($null -eq $stream) { return '' }
    $net = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream)
    $mem = New-Object System.IO.MemoryStream
    $net.CopyTo($mem)
    $type = $stream.ContentType
    if (-not $type) { $type = 'image/png' }
    $net.Dispose()
    if ($mem.Length -gt 3000000) { return '' }
    return 'data:' + $type + ';base64,' + [Convert]::ToBase64String($mem.ToArray())
  } catch { return '' }
}

$reader = New-Object System.IO.StreamReader([Console]::OpenStandardInput())
$pending = $reader.ReadLineAsync()
$lastJson = ''
$thumbKey = ''
$thumbTries = 0

while ($true) {
  try {
    $session = $manager.GetCurrentSession()
    if ($pending.IsCompleted) {
      $cmd = $pending.Result
      if ($null -eq $cmd) { break }
      if ($null -ne $session) {
        switch ($cmd.Trim()) {
          'toggle' { $null = Await ($session.TryTogglePlayPauseAsync()) ([bool]) }
          'next' { $null = Await ($session.TrySkipNextAsync()) ([bool]) }
          'prev' { $null = Await ($session.TrySkipPreviousAsync()) ([bool]) }
          'shuffle' {
            $on = [bool]$session.GetPlaybackInfo().IsShuffleActive
            $null = Await ($session.TryChangeShuffleActiveAsync(-not $on)) ([bool])
          }
        }
      }
      $pending = $reader.ReadLineAsync()
    }
    $out = @{ ok = $true; active = $false }
    if ($null -ne $session) {
      $props = Await ($session.TryGetMediaPropertiesAsync()) $PropsType
      $info = $session.GetPlaybackInfo()
      $time = $session.GetTimelineProperties()
      $controls = $info.Controls
      $out = @{
        ok = $true
        active = $true
        app = [string]$session.SourceAppUserModelId
        title = [string]$props.Title
        artist = [string]$props.Artist
        album = [string]$props.AlbumTitle
        playing = ($info.PlaybackStatus -eq $Playing)
        shuffle = [bool]$info.IsShuffleActive
        canNext = [bool]$controls.IsNextEnabled
        canPrev = [bool]$controls.IsPreviousEnabled
        canShuffle = [bool]$controls.IsShuffleEnabled
        position = [math]::Round($time.Position.TotalSeconds, 1)
        duration = [math]::Round($time.EndTime.TotalSeconds, 1)
        updated = $time.LastUpdatedTime.ToUnixTimeMilliseconds()
      }
      $key = $out.app + '|' + $out.title + '|' + $out.artist
      if ($key -ne $thumbKey) { $thumbKey = $key; $thumbTries = 0 }
      if ($thumbTries -ge 0 -and $thumbTries -lt 6 -and $null -ne $props) {
        $thumbTries++
        $art = Thumb $props.Thumbnail
        if ($art) { $out.thumb = $art; $thumbTries = -1 }
      }
    }
    $json = $out | ConvertTo-Json -Compress
    if ($json -ne $lastJson) {
      [Console]::Out.WriteLine($json)
      [Console]::Out.Flush()
      $lastJson = $json
    }
  } catch {
    [Console]::Out.WriteLine((@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress))
    [Console]::Out.Flush()
    Start-Sleep -Milliseconds 3000
  }
  Start-Sleep -Milliseconds 800
}
`;

/** PowerShell's -EncodedCommand wants the script as UTF-16LE in base64. */
export function encodeScript(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

/** Watches what's playing on Windows. Elsewhere it stays "nothing playing". */
export class NowPlayingWatcher extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private state: NowPlaying = NOTHING_PLAYING;
  private failures = 0;
  private stopped = false;
  private buffer = '';

  constructor(private readonly platform: string = process.platform) {
    super();
  }

  get supported(): boolean {
    return this.platform === 'win32';
  }

  current(): NowPlaying {
    return this.state;
  }

  start(): void {
    if (!this.supported || this.child || this.stopped) return;
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodeScript(HELPER_SCRIPT)], {
      windowsHide: true,
    });
    this.child = child;
    const startedAt = Date.now();
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.read(chunk));
    child.stderr.on('data', () => undefined);
    child.on('error', () => undefined);
    child.on('exit', () => {
      this.child = null;
      this.update(NOTHING_PLAYING);
      if (this.stopped) return;
      // Try again, slower each time it dies quickly; give up after a few.
      this.failures = Date.now() - startedAt < 30_000 ? this.failures + 1 : 0;
      if (this.failures < 5) setTimeout(() => this.start(), 2_000 * 2 ** this.failures);
    });
  }

  stop(): void {
    this.stopped = true;
    this.child?.stdin.end();
    this.child?.kill();
    this.child = null;
  }

  command(cmd: NowPlayingCommand): void {
    if (!NOW_PLAYING_COMMANDS.includes(cmd)) return;
    this.child?.stdin.write(`${cmd}\n`);
  }

  /** Lines can arrive split across chunks; handle each whole one. */
  read(chunk: string): void {
    this.buffer += chunk;
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      const next = parseNowPlaying(line, this.state);
      if (next) this.update(next);
    }
  }

  private update(next: NowPlaying): void {
    this.state = next;
    this.emit('change', next);
  }
}
