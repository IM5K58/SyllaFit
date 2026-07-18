"use client";

// 시간표 상태 저장소 (탭 공유).
// 무로그인: 메모리에만 보관 → 탭 전환엔 유지되지만 새로고침/재접속엔 사라진다(로그인 유도).
// 로그인: 서버 DB와 동기화 (Phase 2b에서 이 Provider에 추가 예정).
import {
  createContext, useContext, useEffect, useRef, useState,
  type Dispatch, type SetStateAction,
} from "react";
import { useSession } from "next-auth/react";

export interface SavedTT { name: string; keys: string[]; savedAt: string; }

interface Store {
  my: string[];                                   // 지금 짜는 시간표(학수번호-분반)
  setMy: Dispatch<SetStateAction<string[]>>;      // 배열 또는 (prev)=>next 둘 다 허용
  library: SavedTT[];                             // 보관함
  saveToLibrary: (name: string, keys: string[]) => string; // 저장(이름 충돌 시 자동 번호) → 최종 이름
  removeFromLibrary: (name: string) => void;
  cloudEnabled: boolean;                          // 로그인+DB로 서버 저장 중인가
}

const Ctx = createContext<Store | null>(null);

export function useTimetables(): Store {
  const c = useContext(Ctx);
  if (!c) throw new Error("useTimetables must be used within <TimetableProvider>");
  return c;
}

export function TimetableProvider({ children }: { children: React.ReactNode }) {
  const [my, setMy] = useState<string[]>([]);
  const [library, setLibrary] = useState<SavedTT[]>([]);
  const [cloudEnabled, setCloudEnabled] = useState(false);

  const { data: session, status } = useSession();
  const email = session?.user?.email ?? null;
  const hydratedEmail = useRef<string | null>(null);

  // 로그인 → 서버에서 로드. 서버가 비어있고 로그인 전 작업이 있으면 그대로 두고(아래 저장 effect가 올림).
  useEffect(() => {
    if (status === "unauthenticated") {
      setCloudEnabled(false);
      hydratedEmail.current = null;
      return;
    }
    if (status !== "authenticated" || !email || hydratedEmail.current === email) return;
    hydratedEmail.current = email;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/timetables");
        if (!r.ok) { setCloudEnabled(false); return; } // 401/501 등 → 클라우드 비활성
        const d = await r.json();
        if (cancelled) return;
        if ((d.working?.length ?? 0) || (d.library?.length ?? 0)) {
          setMy(Array.isArray(d.working) ? d.working : []);
          setLibrary(Array.isArray(d.library) ? d.library : []);
        }
        setCloudEnabled(true); // 로그인 전 작업이 있으면 아래 저장 effect가 서버로 올림
      } catch {
        if (!cancelled) setCloudEnabled(false);
      }
    })();
    return () => { cancelled = true; };
  }, [status, email]);

  // 로그인 중이면 변경 시 서버에 저장(디바운스).
  useEffect(() => {
    if (!cloudEnabled || hydratedEmail.current !== email) return;
    const t = setTimeout(() => {
      void fetch("/api/timetables", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ working: my, library }),
      });
    }, 700);
    return () => clearTimeout(t);
  }, [my, library, cloudEnabled, email]);

  function saveToLibrary(name: string, keys: string[]): string {
    const names = new Set(library.map((s) => s.name));
    let finalName = name;
    if (names.has(finalName)) {
      let n = 2;
      while (names.has(`${name} (${n})`)) n++;
      finalName = `${name} (${n})`;
    }
    const entry: SavedTT = { name: finalName, keys, savedAt: new Date().toISOString().slice(0, 10) };
    setLibrary((prev) => [entry, ...prev]);
    return finalName;
  }

  function removeFromLibrary(name: string) {
    setLibrary((prev) => prev.filter((s) => s.name !== name));
  }

  return (
    <Ctx.Provider value={{ my, setMy, library, saveToLibrary, removeFromLibrary, cloudEnabled }}>
      {children}
    </Ctx.Provider>
  );
}
