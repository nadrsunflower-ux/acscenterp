'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function ClearCachePage() {
  const [status, setStatus] = useState<string>('캐시를 정리하는 중...');
  const router = useRouter();

  useEffect(() => {
    const clearCache = async () => {
      try {
        // IndexedDB 삭제
        const databases = await indexedDB.databases();
        for (const db of databases) {
          if (db.name) {
            indexedDB.deleteDatabase(db.name);
            console.log(`Deleted database: ${db.name}`);
          }
        }

        // LocalStorage 삭제
        localStorage.clear();

        // SessionStorage 삭제
        sessionStorage.clear();

        // Service Worker 삭제
        if ('serviceWorker' in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          for (const registration of registrations) {
            await registration.unregister();
          }
        }

        // Cache API 삭제
        if ('caches' in window) {
          const cacheNames = await caches.keys();
          for (const cacheName of cacheNames) {
            await caches.delete(cacheName);
          }
        }

        setStatus('✅ 캐시가 성공적으로 정리되었습니다! 3초 후 홈으로 이동합니다...');

        setTimeout(() => {
          router.push('/');
          window.location.reload();
        }, 3000);
      } catch (error) {
        console.error('캐시 정리 중 오류:', error);
        setStatus('❌ 캐시 정리 중 오류가 발생했습니다. 수동으로 브라우저 캐시를 삭제해주세요.');
      }
    };

    clearCache();
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="bg-white rounded-xl shadow-xl p-8 max-w-md w-full">
        <h1 className="text-2xl font-bold mb-4 text-center">캐시 정리</h1>
        <p className="text-center text-lg">{status}</p>

        <div className="mt-6 p-4 bg-slate-100 rounded-lg text-sm text-slate-600">
          <p className="font-semibold mb-2">정리되는 항목:</p>
          <ul className="list-disc list-inside space-y-1">
            <li>IndexedDB (Firebase 오프라인 캐시)</li>
            <li>LocalStorage</li>
            <li>SessionStorage</li>
            <li>Service Workers</li>
            <li>Cache API</li>
          </ul>
        </div>

        <button
          onClick={() => {
            router.push('/');
            window.location.reload();
          }}
          className="mt-6 w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2 px-4 rounded-lg transition-colors"
        >
          홈으로 돌아가기
        </button>
      </div>
    </div>
  );
}
