import React, { useRef, useState } from 'react';
import { AlertCircle, ArrowRight, CheckCircle, GraduationCap, Lock, Mail, Sparkles, UserRound } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { UserRole } from '../../types';
import { Button } from '../ui/Button';

interface RegistrationPageProps {
  initialRole?: UserRole;
  onSignIn: (role: UserRole) => void;
  onSuccess: (role: UserRole) => void;
}

export const RegistrationPage: React.FC<RegistrationPageProps> = ({
  initialRole = 'student',
  onSignIn,
  onSuccess,
}) => {
  const { registerStudent, registerFaculty } = useAuth();
  const [accountRole, setAccountRole] = useState<UserRole>(initialRole);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [facultyInviteCode, setFacultyInviteCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmationMessage, setConfirmationMessage] = useState<string | null>(null);
  const submitLock = useRef(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitLock.current) return;
    setErrorMessage(null);
    setConfirmationMessage(null);

    const normalizedEmail = email.trim();
    if (!fullName.trim()) {
      setErrorMessage('Enter your full name.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setErrorMessage('Enter a valid email address.');
      return;
    }
    if (password.length < 8) {
      setErrorMessage('Use a password with at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMessage('The passwords do not match.');
      return;
    }
    if (accountRole === 'instructor' && !facultyInviteCode.trim()) {
      setErrorMessage('Enter your faculty invite code.');
      return;
    }
    submitLock.current = true;
    setIsSubmitting(true);
    try {
      const result = accountRole === 'instructor'
        ? await registerFaculty(fullName.trim(), normalizedEmail, password, facultyInviteCode.trim())
        : await registerStudent(fullName.trim(), normalizedEmail, password);
      if (!result.success) {
        setErrorMessage(result.error || 'We could not create your account. Please try again.');
      } else if (result.requiresEmailConfirmation) {
        setConfirmationMessage(
          accountRole === 'instructor'
            ? `Your faculty account was created. Confirm your email at ${normalizedEmail}, then sign in to the Faculty Portal and enter your invite code to activate access.`
            : `Your student account was created. Check ${normalizedEmail} for a confirmation link, then return here to sign in.`
        );
      } else {
        onSuccess(accountRole);
      }
    } catch {
      setErrorMessage('Registration is temporarily unavailable. Please try again later.');
    } finally {
      submitLock.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col justify-center items-center p-4 selection:bg-indigo-100 selection:text-indigo-900">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-xl bg-[#4338CA] text-white flex items-center justify-center mx-auto shadow-md">
            <Sparkles className="w-6 h-6 text-indigo-100" />
          </div>
          <h1 className="text-2xl font-bold text-[#0F172A] tracking-tight">Student Agent AI</h1>
          <p className="text-xs text-[#64748B]">Create a student account or join the faculty portal</p>
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-6 sm:p-8 shadow-xs space-y-5">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-[#0F172A]">
              Create a {accountRole === 'student' ? 'student' : 'faculty'} account
            </h2>
            <p className="text-xs text-[#64748B]">
              {accountRole === 'student'
                ? 'Create your personalized learning account.'
                : 'Enter a valid faculty invite code to create and enable your faculty account.'}
            </p>
          </div>

          {errorMessage && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-[#B91C1C] flex items-start gap-2" role="alert">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {confirmationMessage && (
            <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-xs text-green-800 flex items-start gap-2" role="status">
              <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{confirmationMessage}</span>
            </div>
          )}

          {!confirmationMessage && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-[#0F172A]">Full name</span>
                <span className="relative flex items-center">
                  <UserRound className="w-4 h-4 text-[#94A3B8] absolute left-3 pointer-events-none" />
                  <input
                    type="text"
                    autoComplete="name"
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    placeholder="Your full name"
                    required
                    className="w-full text-xs bg-slate-50 border border-[#E2E8F0] rounded-lg pl-9 pr-3 py-2.5 text-[#0F172A] placeholder-[#94A3B8] focus:border-[#4338CA] focus:bg-white outline-none transition-colors"
                  />
                </span>
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-[#0F172A]">Email address</span>
                <span className="relative flex items-center">
                  <Mail className="w-4 h-4 text-[#94A3B8] absolute left-3 pointer-events-none" />
                  <input
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="name@university.edu"
                    required
                    className="w-full text-xs bg-slate-50 border border-[#E2E8F0] rounded-lg pl-9 pr-3 py-2.5 text-[#0F172A] placeholder-[#94A3B8] focus:border-[#4338CA] focus:bg-white outline-none transition-colors"
                  />
                </span>
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold text-[#0F172A]">Password</span>
                  <span className="relative flex items-center">
                    <Lock className="w-4 h-4 text-[#94A3B8] absolute left-3 pointer-events-none" />
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      minLength={8}
                      placeholder="At least 8 characters"
                      required
                      className="w-full min-w-0 text-xs bg-slate-50 border border-[#E2E8F0] rounded-lg pl-9 pr-2 py-2.5 text-[#0F172A] placeholder-[#94A3B8] focus:border-[#4338CA] focus:bg-white outline-none transition-colors"
                    />
                  </span>
                </label>
                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold text-[#0F172A]">Confirm password</span>
                  <span className="relative flex items-center">
                    <Lock className="w-4 h-4 text-[#94A3B8] absolute left-3 pointer-events-none" />
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      minLength={8}
                      placeholder="Re-enter password"
                      required
                      className="w-full min-w-0 text-xs bg-slate-50 border border-[#E2E8F0] rounded-lg pl-9 pr-2 py-2.5 text-[#0F172A] placeholder-[#94A3B8] focus:border-[#4338CA] focus:bg-white outline-none transition-colors"
                    />
                  </span>
                </label>
              </div>

              {accountRole === 'instructor' && (
                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold text-[#0F172A]">Faculty invite code</span>
                  <input
                    type="password"
                    autoComplete="off"
                    value={facultyInviteCode}
                    onChange={(event) => setFacultyInviteCode(event.target.value)}
                    placeholder="Enter your invite code"
                    required
                    className="w-full text-xs bg-slate-50 border border-[#E2E8F0] rounded-lg px-3 py-2.5 text-[#0F172A] placeholder-[#94A3B8] focus:border-[#4338CA] focus:bg-white outline-none transition-colors"
                  />
                </label>
              )}

              <label className="flex items-center gap-2 rounded-lg border border-[#E2E8F0] bg-slate-50 px-3 py-2.5 text-xs text-[#475569]">
                <GraduationCap className="w-4 h-4 text-[#4338CA]" />
                <span>Account type:</span>
                <select
                  aria-label="Account type"
                  value={accountRole}
                  onChange={(event) => {
                    setAccountRole(event.target.value as UserRole);
                    setErrorMessage(null);
                    setConfirmationMessage(null);
                  }}
                  className="ml-auto bg-transparent font-semibold text-[#0F172A] outline-none"
                >
                  <option value="student">Student</option>
                  <option value="instructor">Faculty (invite code required)</option>
                </select>
              </label>

              <Button
                type="submit"
                variant="primary"
                size="md"
                className="w-full mt-2"
                isLoading={isSubmitting}
                icon={<ArrowRight className="w-3.5 h-3.5" />}
              >
                Create {accountRole === 'student' ? 'student' : 'faculty'} account
              </Button>
            </form>
          )}

          <p className="text-center text-xs text-[#64748B]">
            Already have an account?{' '}
            <button type="button" onClick={() => onSignIn(accountRole)} className="font-semibold text-[#4338CA] hover:underline">
              Sign in
            </button>
          </p>
        </div>
      </div>
    </div>
  );
};
