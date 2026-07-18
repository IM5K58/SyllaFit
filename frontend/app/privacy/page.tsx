import type { Metadata } from "next";
import Link from "next/link";
import ThemeToggle from "../components/ThemeToggle";

export const metadata: Metadata = {
  title: "개인정보처리방침 — SyllaFit",
  description: "SyllaFit 개인정보처리방침",
};

export default function PrivacyPage() {
  return (
    <>
      <header className="appbar">
        <div className="appbar-inner">
          <Link href="/" className="brand" style={{ textDecoration: "none" }}>
            Sylla<span className="dot">Fit</span>
          </Link>
          <ThemeToggle />
        </div>
      </header>

      <div className="legal">
        <h1>개인정보처리방침</h1>
        <div className="updated">시행일: 2026년 7월 16일</div>

        <div className="box">
          SyllaFit(이하 “서비스”)은 이용자의 개인정보를 소중히 여기며, 「개인정보 보호법」 등
          관련 법령을 준수합니다. <b>현재 서비스는 로그인 없이 제공되며, 이용자를 식별할 수 있는
          개인정보를 수집·저장하지 않습니다.</b>
        </div>

        <h2>1. 수집하는 개인정보</h2>
        <p>
          현재 서비스는 회원가입·로그인 절차가 없으며, 이름·이메일·학번·연락처 등 이용자를
          식별할 수 있는 개인정보를 수집하거나 서버에 저장하지 않습니다.
        </p>

        <h2>2. 서비스 이용 과정에서 처리되는 정보</h2>
        <ul>
          <li>
            이용자가 입력하는 과목 선택 및 선호 문장(예: “오전 회피, 팀플 적은 것”)은 시간표 추천을
            위해 서버로 전송되며, AI 분석을 위해 Upstage의 Solar API로 전달될 수 있습니다.
          </li>
          <li>위 입력은 해당 요청을 처리하는 목적으로만 사용되며, 이용자와 연결하여 별도로 저장하지 않습니다.</li>
          <li>서비스 입력창에는 개인을 식별할 수 있는 정보를 입력하지 마시기 바랍니다.</li>
        </ul>

        <h2>3. 브라우저에 저장되는 정보</h2>
        <p>
          다크/라이트 테마 설정 등 화면 설정이 이용자의 브라우저 로컬 저장소(localStorage)에
          저장됩니다. 이 정보는 서버로 전송되지 않으며, 이용자가 브라우저에서 언제든 삭제할 수 있습니다.
        </p>

        <h2>4. 처리위탁 및 제3자 제공</h2>
        <ul>
          <li>
            <b>AI 분석 위탁:</b> Upstage(Solar API) — 이용자가 입력한 과목·선호 문장의 자연어 처리를
            위해 전달됩니다.
          </li>
          <li>서비스는 위 목적 외에 이용자 정보를 제3자에게 제공하거나 판매하지 않습니다.</li>
        </ul>

        <h2>5. 쿠키 및 추적</h2>
        <p>서비스는 광고 또는 이용자 추적을 목적으로 하는 쿠키·분석 도구를 사용하지 않습니다.</p>

        <h2>6. 개인정보의 보유 및 파기</h2>
        <p>
          서비스는 이용자 개인정보를 서버에 저장하지 않으므로 별도의 보유·파기 대상이 없습니다.
          브라우저에 저장된 설정 정보는 이용자가 직접 삭제할 수 있습니다.
        </p>

        <h2>7. 이용자의 권리</h2>
        <p>이용자는 언제든지 브라우저 설정 또는 저장소 삭제를 통해 로컬에 저장된 정보를 삭제할 수 있습니다.</p>

        <h2>8. 안전성 확보 조치</h2>
        <p>
          AI API 키 등 민감정보는 서버에서만 관리되며 이용자(브라우저)에게 노출되지 않습니다.
          서비스는 필요한 범위에서 합리적인 보호 조치를 취합니다.
        </p>

        <h2>9. 향후 계획</h2>
        <p>
          추후 구글 계정 로그인 및 시간표 저장·리뷰 기능이 도입될 경우, 서비스 제공에 필요한 최소한의
          개인정보(예: 이메일)를 수집하게 됩니다. 이 경우 본 방침을 사전에 개정하여 고지하고,
          이용자의 동의를 받은 후 처리합니다.
        </p>

        <h2>10. 개인정보 보호 문의</h2>
        <p className="muted">문의: gitue11@gmail.com</p>

        <h2>11. 고지의무</h2>
        <p>이 방침은 2026년 7월 16일부터 시행하며, 내용 변경 시 서비스 내 공지를 통해 알립니다.</p>

        <div style={{ marginTop: 32 }}>
          <Link href="/terms">이용약관 →</Link>
        </div>
      </div>
    </>
  );
}
