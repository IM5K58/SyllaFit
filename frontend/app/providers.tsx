"use client";

import { SessionProvider } from "next-auth/react";

// 클라이언트 컴포넌트에서 useSession/signIn/signOut 쓰려면 SessionProvider 필요.
export default function Providers({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
