"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { authRequest, passwordValidationMessage, type AuthUser } from "../lib/authClient";
import { useAuth } from "./AuthProvider";
import { useAppearance } from "./AppearanceProvider";
import SiteBanner from "./SiteBanner";
import styles from "./Auth.module.css";

export default function AccountProfile() {
  const { user, refresh, logout, syncStatus } = useAuth();
  const { appearance, toggleAppearance } = useAppearance();
  const router = useRouter();
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [bio, setBio] = useState(user?.bio ?? "");
  const [emailPassword, setEmailPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileMessage, setProfileMessage] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [logoutError, setLogoutError] = useState("");
  const busy = savingProfile || savingPassword || loggingOut;
  const emailChanged = email.trim().toLowerCase() !== user?.email;
  const profileChanged = displayName.trim() !== user?.displayName || bio.trim() !== (user?.bio ?? "") || emailChanged;

  useEffect(() => { if (!user) router.replace("/login?next=%2Faccount"); }, [user, router]);

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || busy) return;
    setProfileError("");
    setProfileMessage("");
    if (!displayName.trim()) { setProfileError("昵称不能为空。"); return; }
    setSavingProfile(true);
    try {
      const { user: updated } = await authRequest<{ user: AuthUser }>("/api/auth/profile", {
        method: "PATCH",
        body: JSON.stringify({ userId: user.id, displayName: displayName.trim(), bio: bio.trim(), email: email.trim(), ...(emailChanged ? { currentPassword: emailPassword } : {}) }),
      });
      setDisplayName(updated.displayName);
      setEmail(updated.email);
      setBio(updated.bio ?? "");
      setEmailPassword("");
      await refresh(true);
      setProfileMessage("个人信息已保存。");
    } catch (reason) {
      setProfileError(reason instanceof Error ? reason.message : "保存失败，请重试。");
    } finally {
      setSavingProfile(false);
    }
  };

  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || busy) return;
    setPasswordError("");
    setPasswordMessage("");
    const validation = passwordValidationMessage(newPassword);
    if (validation) { setPasswordError(validation); return; }
    if (newPassword !== confirmation) { setPasswordError("两次输入的新密码不一致。"); return; }
    setSavingPassword(true);
    try {
      await authRequest("/api/auth/password", { method: "POST", body: JSON.stringify({ userId: user.id, currentPassword, newPassword }) });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmation("");
      setEmailPassword("");
      await refresh(true);
      setPasswordMessage("密码已更新，其他登录会话已退出。");
    } catch (reason) {
      setPasswordError(reason instanceof Error ? reason.message : "密码修改失败，请重试。");
    } finally {
      setSavingPassword(false);
    }
  };

  const signOut = async () => {
    if (busy) return;
    setLoggingOut(true);
    setLogoutError("");
    try {
      await logout();
      router.replace("/");
    } catch (reason) {
      setLogoutError(reason instanceof Error ? reason.message : "未能保存数据或退出登录，请重试。");
      setLoggingOut(false);
    }
  };

  if (!user) return <main className={styles.sessionScreen}><p role="status">正在前往登录页面…</p></main>;
  const registeredAt = new Date(user.createdAt);
  const registeredDate = Number.isNaN(registeredAt.getTime()) ? "—" : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Shanghai" }).format(registeredAt);

  return <div>
    <SiteBanner activePage="account" appearance={appearance} onToggleAppearance={toggleAppearance} statusText="个人中心" />
    <main className={styles.accountPage}>
      <div className={styles.pageTitle}><div><span className={styles.eyebrow}>你的账号</span><h1>个人中心</h1><p>管理个人信息与登录安全。</p></div><Link className={styles.backLink} href="/">返回工作台 <span aria-hidden="true">↗</span></Link></div>
      <div className={styles.accountLayout}>
        <aside className={styles.profileSummary} aria-label="账号概览">
          <span className={styles.avatar} aria-hidden="true">{Array.from(user.displayName || user.email)[0]?.toUpperCase()}</span>
          <h2>{user.displayName}</h2><p className={styles.summaryEmail}>{user.email}</p>
          <div className={styles.accountDetails}><div><span>加入时间</span><strong>{registeredDate}</strong></div><div><span>数据同步</span><strong className={syncStatus === "error" ? styles.errorText : ""}>{syncStatus === "saving" ? "正在保存…" : syncStatus === "error" ? "同步失败，请重试" : "已同步至数据库"}</strong></div></div>
          <p className={styles.summaryNote}>自选、持仓、研究笔记与复盘记录随账号保存。</p>
        </aside>
        <div className={styles.accountForms}>
          <section className={styles.accountCard} aria-labelledby="profile-heading">
            <div className={styles.cardHeading}><h2 id="profile-heading">个人信息</h2><p>你的昵称、登录邮箱与个人简介。</p></div>
            <form className={styles.form} onSubmit={saveProfile} aria-busy={savingProfile}>
              <label className={styles.field}>昵称<input name="displayName" autoComplete="nickname" required maxLength={40} value={displayName} onChange={(event) => { setDisplayName(event.target.value); setProfileMessage(""); }} disabled={busy} /></label>
              <label className={styles.field}>登录邮箱<input name="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required maxLength={254} value={email} onChange={(event) => { setEmail(event.target.value); setProfileMessage(""); }} disabled={busy} /><small>修改后，请使用新邮箱登录。</small></label>
              {emailChanged && <label className={styles.field}>当前密码<input type="password" name="emailCurrentPassword" autoComplete="current-password" required maxLength={128} value={emailPassword} onChange={(event) => setEmailPassword(event.target.value)} disabled={busy} /><small>修改登录邮箱前，请输入当前密码确认身份。</small></label>}
              <label className={styles.field}><span className={styles.fieldTitle}>个人简介 <span>{bio.length}/500</span></span><textarea name="bio" rows={4} maxLength={500} placeholder="记录你的研究方向或投资习惯…" value={bio} onChange={(event) => { setBio(event.target.value); setProfileMessage(""); }} disabled={busy} /></label>
              {profileError && <p className={styles.error} role="alert">{profileError}</p>}
              {profileMessage && <p className={styles.success} role="status">{profileMessage}</p>}
              <div className={styles.formActions}><button className={styles.primaryButton} type="submit" disabled={busy || !profileChanged}>{savingProfile ? "正在保存…" : "保存个人信息"}</button></div>
            </form>
          </section>
          <section className={styles.accountCard} aria-labelledby="password-heading">
            <div className={styles.cardHeading}><h2 id="password-heading">登录安全</h2><p>更新密码后，其他登录会话将自动退出。</p></div>
            <form className={styles.form} onSubmit={changePassword} aria-busy={savingPassword}>
              <label className={styles.field}>当前密码<input type="password" name="currentPassword" autoComplete="current-password" required maxLength={128} value={currentPassword} onChange={(event) => { setCurrentPassword(event.target.value); setPasswordMessage(""); }} disabled={busy} /></label>
              <div className={styles.fieldRow}><label className={styles.field}>新密码<input type="password" name="newPassword" autoComplete="new-password" required minLength={8} maxLength={128} value={newPassword} onChange={(event) => { setNewPassword(event.target.value); setPasswordMessage(""); }} disabled={busy} aria-describedby="new-password-help" /></label><label className={styles.field}>确认新密码<input type="password" name="newPasswordConfirmation" autoComplete="new-password" required minLength={8} maxLength={128} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={busy} /></label></div>
              <p id="new-password-help" className={styles.helper}>8–128 个字符，同时包含英文字母和数字。</p>
              {passwordError && <p className={styles.error} role="alert">{passwordError}</p>}
              {passwordMessage && <p className={styles.success} role="status">{passwordMessage}</p>}
              <div className={styles.formActions}><button className={styles.secondaryButton} type="submit" disabled={busy}>{savingPassword ? "正在更新…" : "更新密码"}</button></div>
            </form>
          </section>
          <section className={`${styles.accountCard} ${styles.signOutCard}`} aria-labelledby="sign-out-heading"><div><h2 id="sign-out-heading">退出登录</h2><p>退出前会保存待同步的数据，之后仍可查询股票。</p>{logoutError && <p className={styles.error} role="alert">{logoutError}</p>}</div><button className={styles.secondaryButton} type="button" onClick={() => void signOut()} disabled={busy}>{loggingOut ? "正在保存并退出…" : "退出登录"}</button></section>
        </div>
      </div>
    </main>
  </div>;
}
