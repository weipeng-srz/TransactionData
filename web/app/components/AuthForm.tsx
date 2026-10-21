"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { authRequest, passwordValidationMessage, safeAuthReturnPath } from "../lib/authClient";
import { useAuth } from "./AuthProvider";
import styles from "./Auth.module.css";

export default function AuthForm({ mode }: { mode: "login" | "register" }) {
  const isRegister = mode === "register";
  const { user, refresh } = useAuth();
  const router = useRouter();
  const [next] = useState(() => typeof window === "undefined" ? "/" : safeAuthReturnPath(new URLSearchParams(window.location.search).get("next")));
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { if (user) router.replace(next); }, [user, next, router]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (isRegister) {
      if (!displayName.trim()) { setError("请填写你的昵称。"); return; }
      const passwordError = passwordValidationMessage(password);
      if (passwordError) { setError(passwordError); return; }
      if (password !== confirmation) { setError("两次输入的密码不一致。"); return; }
    }
    setBusy(true);
    try {
      await authRequest(`/api/auth/${mode}`, { method: "POST", body: JSON.stringify({ email: email.trim(), password, ...(isRegister ? { displayName: displayName.trim() } : {}) }) });
      setPassword("");
      setConfirmation("");
      await refresh(true);
      if (typeof BroadcastChannel !== "undefined") {
        const channel = new BroadcastChannel("trendsight-auth");
        channel.postMessage("session-changed");
        channel.close();
      }
      router.replace(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "操作未完成，请重试。");
    } finally {
      setBusy(false);
    }
  };

  return <main className={styles.authPage}>
    <header className={styles.authHeader}><Link className={styles.brand} href="/"><span className={styles.brandMark} aria-hidden="true" /><span>TrendSight<small>市场研究工作台</small></span></Link><Link className={styles.backLink} href="/">继续查询股票 <span aria-hidden="true">↗</span></Link></header>
    <div className={styles.authLayout}>
      <section className={styles.introduction}>
        <span className={styles.eyebrow}>你的个人研究空间</span>
        <h1>让每一次观察，<br />都有迹可循。</h1>
        <p>从自选到持仓，从研究到复盘。<br />把你的市场判断，积累在同一个地方。</p>
        <div className={styles.featureList}>
          <div><span aria-hidden="true">01</span><div><strong>建立自己的观察清单</strong><p>整理自选与持仓，保持对市场的关注。</p></div></div>
          <div><span aria-hidden="true">02</span><div><strong>留下完整的研究轨迹</strong><p>保存研究笔记与交易复盘，持续回看。</p></div></div>
          <div><span aria-hidden="true">03</span><div><strong>随账号同步你的数据</strong><p>数据保存到数据库，登录后继续研究。</p></div></div>
        </div>
      </section>
      <section className={styles.formCard} aria-labelledby="auth-title">
        <span className={styles.eyebrow}>{isRegister ? "开始积累" : "欢迎回来"}</span>
        <h2 id="auth-title">{isRegister ? "创建你的账号" : "登录 TrendSight"}</h2>
        <p className={styles.formIntro}>{isRegister ? "一个账号，保存你的研究与记录。" : "继续你的观察、研究与复盘。"}</p>
        <form onSubmit={submit} className={styles.form} aria-busy={busy}>
          {isRegister && <label className={styles.field}>昵称<input name="displayName" autoComplete="nickname" placeholder="如何称呼你" required maxLength={40} value={displayName} onChange={(event) => setDisplayName(event.target.value)} disabled={busy} /></label>}
          <label className={styles.field}>邮箱<input type="email" name="email" autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="name@example.com" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy} /></label>
          <label className={styles.field}>密码<div className={styles.passwordInput}><input type={showPassword ? "text" : "password"} name="password" autoComplete={isRegister ? "new-password" : "current-password"} placeholder={isRegister ? "至少 8 位，包含字母和数字" : "输入你的密码"} required minLength={isRegister ? 8 : undefined} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} aria-describedby={isRegister ? "password-help" : undefined} /><button type="button" aria-label={showPassword ? "隐藏密码" : "显示密码"} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>{showPassword ? "隐藏" : "显示"}</button></div>{isRegister && <small id="password-help">8–128 个字符，同时包含英文字母和数字。</small>}</label>
          {isRegister && <label className={styles.field}>确认密码<input type={showPassword ? "text" : "password"} name="passwordConfirmation" autoComplete="new-password" placeholder="再次输入密码" required minLength={8} maxLength={128} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={busy} /></label>}
          {error && <p className={styles.error} role="alert">{error}</p>}
          <button className={styles.primaryButton} type="submit" disabled={busy}>{busy ? (isRegister ? "正在创建账号…" : "正在登录…") : (isRegister ? "创建账号并登录" : "登录")}</button>
        </form>
        <p className={styles.switchMode}>{isRegister ? "已经有账号？" : "还没有账号？"}<Link href={`/${isRegister ? "login" : "register"}${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`}>{isRegister ? "去登录" : "创建账号"} <span aria-hidden="true">→</span></Link></p>
      </section>
    </div>
    <footer className={styles.authFooter}>未登录也可以查询 A 股与美股行情。</footer>
  </main>;
}
