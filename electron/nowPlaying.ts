import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { lookupArt } from './albumArt';
import fs from 'node:fs';
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
$ProgressPreference = 'SilentlyContinue'
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

$DataReaderType = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
$PartialRead = [Windows.Storage.Streams.InputStreamOptions, Windows.Storage.Streams, ContentType = WindowsRuntime]::Partial
$InMemoryType = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.RandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$asTaskProgress = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperationWithProgress${'`'}2'
} | Select-Object -First 1
function AwaitProgress($op, [Type]$result, [Type]$progress) {
  $task = $asTaskProgress.MakeGenericMethod($result, $progress).Invoke($null, @($op))
  if (-not $task.Wait(4000)) { return $null }
  return $task.Result
}
$thumbError = ''

# Album art as a data: URL. Read with a DataReader, the way Windows PowerShell
# handles best; if that fails, try .NET's stream bridge. The image type comes
# from the bytes, since apps don't always say.
function Thumb($ref) {
  if ($null -eq $ref) { $script:thumbError = 'no thumbnail yet'; return '' }
  # Windows PowerShell can't call methods on the stream Windows hands back (it
  # only sees a bare COM object), but .NET methods that take it as an argument
  # can. So only ever pass it along, and try three ways in turn.
  $errors = @()
  $bytes = $null
  try {
    $stream = Await ($ref.OpenReadAsync()) $StreamType
  } catch {
    $script:thumbError = 'open: ' + $_.Exception.Message
    return ''
  }
  if ($null -eq $stream) { $script:thumbError = 'thumbnail did not open'; return '' }

  # 1. A DataReader over it, read in chunks until it runs out.
  try {
    $reader = $DataReaderType::new($stream)
    $reader.InputStreamOptions = $PartialRead
    $mem = New-Object System.IO.MemoryStream
    while ($mem.Length -lt 3000000) {
      $n = [uint32](Await ($reader.LoadAsync(65536)) ([uint32]))
      if ($n -eq 0) { break }
      $chunk = New-Object byte[] $n
      $reader.ReadBytes($chunk)
      $mem.Write($chunk, 0, $n)
    }
    $reader.DetachStream() | Out-Null
    if ($mem.Length -gt 0) { $bytes = $mem.ToArray() } else { $errors += 'reader: empty' }
  } catch { $errors += 'reader: ' + $_.Exception.Message }

  # 2. .NET's bridge from a Windows stream to a normal one.
  if ($null -eq $bytes) {
    try {
      $net = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead([Windows.Storage.Streams.IInputStream]$stream)
      $mem = New-Object System.IO.MemoryStream
      $net.CopyTo($mem)
      if ($mem.Length -gt 0) { $bytes = $mem.ToArray() } else { $errors += 'bridge: empty' }
    } catch { $errors += 'bridge: ' + $_.Exception.Message }
  }

  # 3. Copy it into a Windows memory stream Life Hub made itself, then read that.
  if ($null -eq $bytes) {
    try {
      $copy = $InMemoryType::new()
      $null = AwaitProgress ([Windows.Storage.Streams.RandomAccessStream]::CopyAsync($stream, $copy)) ([uint64]) ([uint64])
      $copy.Seek(0)
      $net = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($copy.GetInputStreamAt(0))
      $mem = New-Object System.IO.MemoryStream
      $net.CopyTo($mem)
      if ($mem.Length -gt 0) { $bytes = $mem.ToArray() } else { $errors += 'copy: empty' }
    } catch { $errors += 'copy: ' + $_.Exception.Message }
  }

  if ($null -eq $bytes) { $script:thumbError = $errors -join ' | '; return '' }
  if ($null -eq $bytes -or $bytes.Length -lt 8) { return '' }
  $type = 'image/jpeg'
  if ($bytes[0] -eq 0x89 -and $bytes[1] -eq 0x50) { $type = 'image/png' }
  elseif ($bytes[0] -eq 0x47 -and $bytes[1] -eq 0x49) { $type = 'image/gif' }
  elseif ($bytes[0] -eq 0x42 -and $bytes[1] -eq 0x4D) { $type = 'image/bmp' }
  elseif ($bytes.Length -gt 12 -and $bytes[8] -eq 0x57 -and $bytes[9] -eq 0x45 -and $bytes[10] -eq 0x42 -and $bytes[11] -eq 0x50) { $type = 'image/webp' }
  $script:thumbError = ''
  return 'data:' + $type + ';base64,' + [Convert]::ToBase64String($bytes)
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
        elseif ($thumbTries -ge 6 -and $thumbError) { $out.thumbError = $thumbError }
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

  constructor(
    private readonly platform: string = process.platform,
    /** Where problems are written, so a missing album cover can be looked into. */
    private readonly logFile?: string,
    /** Finds a cover online when the app doesn't share one; swappable for tests. */
    private readonly artLookup: (artist: string, album: string, title: string) => Promise<string | null> = lookupArt,
  ) {
    super();
  }

  private log(message: string): void {
    if (!this.logFile) return;
    try {
      if (fs.existsSync(this.logFile) && fs.statSync(this.logFile).size > 200_000) fs.writeFileSync(this.logFile, '');
      fs.appendFileSync(this.logFile, `${new Date().toISOString()} ${message.trim().slice(0, 500)}\n`);
    } catch {
      // Logging is best effort.
    }
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
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (text: string) => {
      // PowerShell's own progress notes ("#< CLIXML") aren't errors.
      const real = text.replace(/#< CLIXML\s*/g, '').replace(/<Objs[\s\S]*?<\/Objs>/g, '').trim();
      if (real) this.log(`helper error: ${real}`);
    });
    child.on('error', (err) => this.log(`couldn't start PowerShell: ${err.message}`));
    child.on('exit', (code) => {
      this.log(`helper stopped (code ${code})`);
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
      if (line.includes('"thumbError"') || line.includes('"ok":false')) this.log(line.replace(/"thumb":"[^"]*"/, '"thumb":"…"'));
      const next = parseNowPlaying(line, this.state);
      if (next) this.update(next);
    }
  }

  private update(next: NowPlaying): void {
    this.state = next;
    this.emit('change', next);
    if (next.active && !next.self && !next.art) void this.findArt(next);
  }

  private lookingUp = '';

  /** No cover from the app: look the album up online instead (see albumArt.ts). */
  private async findArt(np: NowPlaying): Promise<void> {
    const key = `${np.app}|${np.artist}|${np.album}|${np.title}`;
    if (this.lookingUp === key) return;
    this.lookingUp = key;
    const art = await this.artLookup(np.artist, np.album, np.title);
    const now = this.state;
    // Still the same song, and the app didn't send its own cover meanwhile.
    if (art && now.active && !now.art && `${now.app}|${now.artist}|${now.album}|${now.title}` === key) {
      this.state = { ...now, art };
      this.emit('change', this.state);
    }
  }
}
