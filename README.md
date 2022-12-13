Node M3U8 Downloader
====================

# Introduction

Well, sometimes I want to download video that in stream format, so I create this script, it has no depends (but needs `ffmpeg` to concat ts files).

Some video website can be strange so the code is dirty, currently it supports ts and fmp4 (fragment mp4).

# Usage

```shell
$ node ./m3u8-downloader.js M3U8_URL OUTPUT_FILE_NAME
```

If you want parallel downloading, or some cookie is needed, create a `config.json` in your working dir:

```json
{
  "workers": 8,
  "cookie": "XXXXXXXX"
}
```

# For Twitter Videos

Twitter video's first m3u8 contains a m3u8 list for different resolutions, so you should manually open it and choose one, those are absolute paths and origin should typically be `https://video.twimg.com/`.

If you open m3u8 files you chose, they are also absolute paths, the script will detect and handle them correctly.

Twitter uses fragment mp4 instead of ts, a mp4 header file is in comment, the script will download it and then concat all those m4s files after it.
