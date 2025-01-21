export interface MediaInfo {
  width: number;
  height: number;
  codec: string;
}

class FileInfo {
  public mediaInfo: MediaInfo | null = null;
  constructor(public fileName: string, public inode: number, public size: number, public mtime: number) {}
}

export default FileInfo;
