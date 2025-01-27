# Video Converter

## Overview

Video Converter is a tool designed to scan directories for video files, process them using FFmpeg, and output the results while preserving the directory structure. It supports pausing and resuming tasks, and can preserve file attributes such as modified dates.  

## Requirements

- Windows OS
- Node.js
- FFmpeg (must be installed separately and available in the system PATH)

## Installation

1. Clone the repository:  
```shell
git clone <repository-url>
cd <repository-directory>
```

2. Install dependencies:  
```shell
pnpm install
```

## Running the Application

1. Ensure FFmpeg is installed and available in your system PATH.
2. Start the application (ts-node):  
```shell
pnpm run dev
```

## Packaging the Application

To package the application into an executable:  
 
```shell
pnpm run package
```
This will create an executable file for Windows.

## Cache and config

The app creates a cache database using sqlite3 in the folder it runs from. It also takes a config or a folder with the config as a parameter. The config file should be a JSON file with the options described below. If no config is found a default will be created for you which you can then alter.

## Options

The application supports the following options:

- `srcDir`: The source directory to scan for video files.
- `dstDir`: The destination directory to output processed files. If not specified, the source directory will be used.
- `deep`: How deep to scan the source directory for video files. 0 for the source directory only.
- `force`: Before processing the files, the app uses ffprobe to check the information about them. This option skips this step. Note that the data from ffprobe is cached, so if you are processing the same folder multiple times, the files that were probed before will retain that information anyway.
- `deleteOriginal`: Delete the original files after processing.
- `preserveAttributes`: Preserve the modified date of the original file.
- `videoOptions.outputContainer`: The output container format for the processed video files.
- `videoOptions.ffmpegCommand`: The FFmpeg command to use for processing video files. Supply the necessary arguments to pass to ffmpeg omitting the input and output filenames.
- `ffmpegPath`: The path to the FFmpeg executable. If not specified, the app will attempt to use the FFmpeg executable in the system PATH.
- `filterBy`: An object containing the following properties:
  - `extension`: Only select the files with a specified extension.
  - `codec`: A glob pattern to match the codec name.

```shell
{
  "srcDir": "C:\\path\\to\\source",
  "dstDir": "C:\\path\\to\\destination",
  "deep": true,
  "force": false,
  "deleteOriginal": false,
  "preserveAttributes": true,
  "videoOptions": {
    "outputContainer": "mp4",
    "ffmpegCommand": "-c:v libx264 -crf 23 -preset medium"
  },
  "ffmpegPath": "C:\\path\\to\\ffmpeg.exe"
}
```
