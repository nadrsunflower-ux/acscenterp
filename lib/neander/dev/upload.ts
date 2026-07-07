import { ref as storageRef, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { getNeanderStorage } from "@/lib/neander/firebase";
import type { DevAttachment } from "@/lib/neander/dev/types";

/** 파일명에서 Storage 경로에 안전하지 않은 문자를 정리 (chat.ts와 동일 규칙) */
function safeFileName(name: string): string {
  return name.replace(/[^\w.\-가-힣]+/g, "_").slice(0, 120) || "file";
}

/**
 * 개발 허브용 이미지/파일 업로드.
 * Storage 경로: neander_dev/<scope>/<Date.now()>_<safeName>
 * onProgress 로 0~100 진행률 콜백. 이미지면 kind:"image".
 */
export function uploadDevFile(
  scope: string,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<DevAttachment> {
  return new Promise((resolve, reject) => {
    const contentType = file.type || "application/octet-stream";
    const path = `neander_dev/${scope}/${Date.now()}_${safeFileName(file.name)}`;
    const task = uploadBytesResumable(storageRef(getNeanderStorage(), path), file, {
      contentType,
    });
    task.on(
      "state_changed",
      (snap) => {
        if (snap.totalBytes > 0) {
          onProgress?.(Math.round((snap.bytesTransferred / snap.totalBytes) * 100));
        }
      },
      reject,
      async () => {
        try {
          onProgress?.(100);
          const url = await getDownloadURL(task.snapshot.ref);
          resolve({
            kind: contentType.startsWith("image/") ? "image" : "file",
            url,
            name: file.name,
            contentType,
            size: file.size,
          });
        } catch (e) {
          reject(e as Error);
        }
      },
    );
  });
}
