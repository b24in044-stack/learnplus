import React, { useState } from 'react';
import {
  Sparkles,
  Lock,
  Mail,
  Eye,
  EyeOff,
  GraduationCap,
  ShieldCheck,
  ArrowRight,
  AlertCircle,
  CheckCircle,
  HelpCircle
} from 'lucide-react';
import { UserRole } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { supabaseConfigurationStatus } from '../../services/supabase';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Badge } from '../ui/Badge';

interface LoginPageProps {
  initialRole?: UserRole;
  onSuccess: (role: UserRole) => void;
  onRegister: () => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({
  initialRole = 'student',
  onSuccess,
  onRegister
}) => {
  const { signIn, isPasswordRecovery, completePasswordReset } = useAuth();
  const isDemoMode = import.meta.env.VITE_DEMO_MODE === 'true';
  const [activeRole, setActiveRole] = useState<UserRole>(initialRole);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [facultyInviteCode, setFacultyInviteCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotError, setForgotError] = useState<string | null>(null);
  const [isSendingReset, setIsSendingReset] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);

  const handleRoleChange = (newRole: UserRole) => {
    setActiveRole(newRole);
    setErrorMessage(null);
    window.location.hash = newRole === 'student'
      ? 'login/student'
      : newRole === 'instructor' ? 'login/faculty' : 'login/admin';
    setEmail('');
    setPassword('');
    setFacultyInviteCode('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const res = activeRole === 'instructor' && !isDemoMode
        ? await signIn(email, password, activeRole, facultyInviteCode)
        : await signIn(email, password, activeRole);
      if (res.success) {
        onSuccess(activeRole);
      } else {
        setErrorMessage(res.error || 'Authentication failed. Please verify credentials.');
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Error communicating with authentication service.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotEmail || !forgotEmail.includes('@') || isSendingReset) return;
    setForgotError(null);
    setIsSendingReset(true);
    try {
      await api.sendPasswordReset(forgotEmail.trim());
      setForgotSent(true);
    } catch (error) {
      setForgotError(error instanceof Error ? error.message : 'Password recovery is unavailable.');
    } finally {
      setIsSendingReset(false);
    }
  };

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      setRecoveryError('Use a password with at least 8 characters.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setRecoveryError('The passwords do not match.');
      return;
    }
    setIsUpdatingPassword(true);
    setRecoveryError(null);
    try {
      await completePasswordReset(newPassword);
    } catch (error) {
      setRecoveryError(error instanceof Error ? error.message : 'Password could not be updated.');
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  if (isPasswordRecovery) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex flex-col justify-center items-center p-4">
        <form onSubmit={handlePasswordReset} className="w-full max-w-md rounded-2xl border border-[#E2E8F0] bg-white p-6 space-y-4 shadow-sm">
          <div>
            <h1 className="text-xl font-bold text-[#0F172A]">Set a new password</h1>
            <p className="mt-1 text-xs text-[#64748B]">Choose a new password for your academic account.</p>
          </div>
          {recoveryError && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700" role="alert">{recoveryError}</p>}
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-[#0F172A]">New password</span>
            <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={8} autoComplete="new-password" required className="w-full rounded-lg border border-[#E2E8F0] bg-slate-50 p-2.5 text-xs text-[#0F172A]" />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-[#0F172A]">Confirm new password</span>
            <input type="password" value={confirmNewPassword} onChange={(event) => setConfirmNewPassword(event.target.value)} minLength={8} autoComplete="new-password" required className="w-full rounded-lg border border-[#E2E8F0] bg-slate-50 p-2.5 text-xs text-[#0F172A]" />
          </label>
          <Button type="submit" variant="primary" className="w-full" isLoading={isUpdatingPassword}>Update password</Button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col justify-center items-center p-4 selection:bg-indigo-100 selection:text-indigo-900">
      <div className="w-full max-w-md space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-xl bg-[#4338CA] text-white flex items-center justify-center mx-auto shadow-md">
            <Sparkles className="w-6 h-6 text-indigo-100" />
          </div>
          <h1 className="text-2xl font-bold text-[#0F172A] tracking-tight">
            Student Agent AI
          </h1>
          <p className="text-xs text-[#64748B]">
            Personalized Learning Platform
          </p>
        </div>

        {/* Portal Role Selector Tabs */}
        <div className={`bg-slate-200/80 p-1 rounded-xl grid ${isDemoMode ? 'grid-cols-2' : 'grid-cols-3'} items-center text-xs font-semibold`}>
          <button
            type="button"
            onClick={() => handleRoleChange('student')}
            className={`flex-1 py-2 px-3 rounded-lg flex items-center justify-center gap-2 transition-all cursor-pointer ${
              activeRole === 'student'
                ? 'bg-white text-[#0F172A] shadow-xs'
                : 'text-[#64748B] hover:text-[#0F172A]'
            }`}
          >
            <GraduationCap className="w-4 h-4 text-[#4338CA]" />
            <span>Student Portal</span>
          </button>

          <button
            type="button"
            onClick={() => handleRoleChange('instructor')}
            className={`flex-1 py-2 px-3 rounded-lg flex items-center justify-center gap-2 transition-all cursor-pointer ${
              activeRole === 'instructor'
                ? 'bg-white text-[#0F172A] shadow-xs'
                : 'text-[#64748B] hover:text-[#0F172A]'
            }`}
          >
            <ShieldCheck className="w-4 h-4 text-[#0D9488]" />
            <span>Faculty Portal</span>
          </button>
          {!isDemoMode && (
            <button
              type="button"
              onClick={() => handleRoleChange('admin')}
              className={`py-2 px-2 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                activeRole === 'admin'
                  ? 'bg-white text-[#0F172A] shadow-xs'
                  : 'text-[#64748B] hover:text-[#0F172A]'
              }`}
            >
              <ShieldCheck className="w-4 h-4 text-[#4338CA]" />
              <span>Admin</span>
            </button>
          )}
        </div>

        {/* Login Card */}
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-6 sm:p-8 shadow-xs space-y-5">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-[#0F172A]">
              {activeRole === 'student' ? 'Student Sign In' : activeRole === 'admin' ? 'Administrator Sign In' : 'Faculty & Instructor Sign In'}
            </h2>
            <p className="text-xs text-[#64748B]">
              {activeRole === 'student'
                ? 'Access your course syllabi, AI tutor workspace, and adaptive diagnostics.'
                : activeRole === 'admin'
                  ? 'Create courses and assign them to faculty.'
                  : 'Manage course content, synthesize AI quizzes, and review cohort diagnostics.'}
            </p>
          </div>

          {!isDemoMode && (!supabaseConfigurationStatus.urlPresent || !supabaseConfigurationStatus.publishableKeyPresent) ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900" role="status">
              <p className="font-semibold">Supabase frontend configuration is incomplete.</p>
              <p className="mt-1">
                Project URL: {supabaseConfigurationStatus.urlPresent ? 'present' : 'missing'} ·
                {' '}Publishable key: {supabaseConfigurationStatus.publishableKeyPresent ? 'present' : 'missing'}
              </p>
              <p className="mt-1">Restart Vite after changing .env. Only presence is shown; values are never displayed.</p>
            </div>
          ) : null}

          {errorMessage && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-[#B91C1C] flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email Field */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-[#0F172A]">
                Institutional Email
              </label>
              <div className="relative flex items-center">
                <Mail className="w-4 h-4 text-[#94A3B8] absolute left-3 pointer-events-none" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={
                    activeRole === 'student'
                      ? 'student@university.edu'
                      : activeRole === 'admin' ? 'admin@university.edu' : 'faculty@university.edu'
                  }
                  required
                  className="w-full text-xs bg-slate-50 border border-[#E2E8F0] rounded-lg pl-9 pr-3 py-2 text-[#0F172A] placeholder-[#94A3B8] focus:border-[#4338CA] focus:bg-white outline-none transition-colors"
                />
              </div>
            </div>

            {/* Password Field */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-[#0F172A]">
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setForgotEmail(email);
                    setShowForgotPassword(true);
                  }}
                  className="text-[11px] font-medium text-[#4338CA] hover:underline"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative flex items-center">
                <Lock className="w-4 h-4 text-[#94A3B8] absolute left-3 pointer-events-none" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your academic password"
                  required
                  className="w-full text-xs bg-slate-50 border border-[#E2E8F0] rounded-lg pl-9 pr-9 py-2 text-[#0F172A] placeholder-[#94A3B8] focus:border-[#4338CA] focus:bg-white outline-none transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="p-1 text-[#94A3B8] hover:text-[#0F172A] absolute right-2.5 cursor-pointer"
                  title={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {activeRole === 'instructor' && !isDemoMode && (
              <div className="space-y-1.5">
                <label htmlFor="faculty-login-invite-code" className="text-xs font-semibold text-[#0F172A]">
                  Faculty invite code
                </label>
                <input
                  id="faculty-login-invite-code"
                  type="password"
                  autoComplete="off"
                  value={facultyInviteCode}
                  onChange={(event) => setFacultyInviteCode(event.target.value)}
                  placeholder="Enter your invite code"
                  className="w-full text-xs bg-slate-50 border border-[#E2E8F0] rounded-lg px-3 py-2 text-[#0F172A] placeholder-[#94A3B8] focus:border-[#4338CA] focus:bg-white outline-none transition-colors"
                />
              </div>
            )}

            {/* Submit Button */}
            <Button
              type="submit"
              variant="primary"
              size="md"
              className="w-full mt-2"
              isLoading={isLoading}
              icon={<ArrowRight className="w-3.5 h-3.5" />}
            >
              Sign In to {activeRole === 'student' ? 'Student Portal' : activeRole === 'admin' ? 'Administrator Portal' : 'Faculty Portal'}
            </Button>
          </form>

          {!isDemoMode && activeRole !== 'admin' && (
            <p className="text-center text-xs text-[#64748B]">
              New to Student Agent AI?{' '}
              <button type="button" onClick={onRegister} className="font-semibold text-[#4338CA] hover:underline">
                Create account
              </button>
            </p>
          )}

          {isDemoMode && (
            <div className="pt-3 border-t border-[#F1F5F9] flex items-center justify-between text-xs text-[#64748B]">
              <span>Demo credentials:</span>
              <button
                type="button"
                onClick={() => {
                  setEmail(activeRole === 'student' ? 'a.chen@university.edu' : 'elena.rostova@university.edu');
                  setPassword(activeRole === 'student' ? 'AcademicPass2026!' : 'FacultyPass2026!');
                }}
                className="text-[#4338CA] font-semibold hover:underline cursor-pointer"
              >
                Auto-fill {activeRole === 'student' ? 'Alex Chen' : 'Dr. Elena Rostova'}
              </button>
            </div>
          )}
        </div>

        <p className="text-center text-[11px] text-[#94A3B8]">
          {activeRole === 'admin'
            ? 'Administrator accounts are provisioned by your platform owner.'
            : 'Faculty accounts are created and enabled with a valid invite code.'}
        </p>
      </div>

      {/* Forgot Password Dialog */}
      <Dialog
        isOpen={showForgotPassword}
        onClose={() => {
          setShowForgotPassword(false);
          setForgotSent(false);
          setForgotError(null);
        }}
        title="Reset Academic Account Password"
        description="Enter your registered campus email to receive a secure password reset link."
        footer={
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setShowForgotPassword(false);
              setForgotSent(false);
              setForgotError(null);
            }}
          >
            Close
          </Button>
        }
      >
        {forgotSent ? (
          <div className="p-4 bg-green-50 border border-green-200 rounded-xl space-y-2 text-xs text-[#15803D]">
            <div className="flex items-center gap-2 font-semibold">
              <CheckCircle className="w-4 h-4" />
              <span>Reset Link Dispatched</span>
            </div>
            <p className="text-green-800 leading-relaxed">
              If an academic account exists for <strong className="font-bold">{forgotEmail}</strong>, password reset instructions have been sent.
            </p>
          </div>
        ) : (
          <form onSubmit={handleForgotSubmit} className="space-y-3">
            {forgotError && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700" role="alert">{forgotError}</p>}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-[#0F172A]">
                Campus Email Address
              </label>
              <input
                type="email"
                value={forgotEmail}
                onChange={(e) => setForgotEmail(e.target.value)}
                placeholder="name@university.edu"
                required
                className="w-full text-xs bg-slate-50 border border-[#E2E8F0] rounded-lg p-2.5 text-[#0F172A] outline-none focus:border-[#4338CA]"
              />
            </div>
            <Button type="submit" variant="primary" size="sm" className="w-full" isLoading={isSendingReset}>
              Send Password Reset Instructions
            </Button>
          </form>
        )}
      </Dialog>
    </div>
  );
};
