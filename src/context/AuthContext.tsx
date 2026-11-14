import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { User, UserRole } from '../types';
import { api } from '../services/api';
import { getSupabaseClient, isSupabaseConfigured } from '../services/supabase';

interface AuthContextType {
  user: User;
  role: UserRole;
  isAuthenticated: boolean;
  isRestoringSession: boolean;
  isPasswordRecovery: boolean;
  sessionVersion: number;
  signIn: (email: string, password: string, role: UserRole, facultyInviteCode?: string) => Promise<{ success: boolean; error?: string }>;
  registerStudent: (fullName: string, email: string, password: string) => Promise<{
    success: boolean;
    requiresEmailConfirmation?: boolean;
    error?: string;
  }>;
  registerFaculty: (fullName: string, email: string, password: string, inviteCode: string) => Promise<{
    success: boolean;
    requiresEmailConfirmation?: boolean;
    error?: string;
  }>;
  completePasswordReset: (password: string) => Promise<void>;
  switchRole: (role: UserRole) => Promise<void>;
  setUser: (user: User) => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const EMPTY_USER: User = {
  id: '',
  name: '',
  email: '',
  role: 'student',
  avatarUrl: '',
  department: '',
  departmentId: undefined,
  branchId: undefined,
  regulationId: undefined,
  academicYearId: undefined,
  currentSemesterId: undefined,
  enrolledSince: '',
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [role, setRole] = useState<UserRole>(() => {
    const storedRole = localStorage.getItem('sa_ai_role');
    return storedRole === 'instructor' || storedRole === 'admin' ? storedRole : 'student';
  });
  const roleAtMount = useRef(role);
  const sessionGeneration = useRef(0);
  const authSessionUserId = useRef<string | null>(null);
  const isSigningOut = useRef(false);

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isRestoringSession, setIsRestoringSession] = useState(true);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  const [sessionVersion, setSessionVersion] = useState(0);

  const [user, setUser] = useState<User>(() => ({ ...EMPTY_USER, role }));

  const signIn = async (
    email: string,
    password: string,
    targetRole: UserRole,
    facultyInviteCode?: string,
  ): Promise<{ success: boolean; error?: string }> => {
    if (!email.trim() || !password.trim()) {
      return { success: false, error: 'Please enter both your academic email and password.' };
    }
    if (!email.includes('@')) {
      return { success: false, error: 'Please provide a valid institutional email address.' };
    }

    try {
      const result = targetRole === 'instructor'
        ? await api.login(email.trim(), password, targetRole, facultyInviteCode)
        : await api.login(email.trim(), password, targetRole);
      localStorage.setItem('sa_ai_role', targetRole);
      setRole(targetRole);
      setUser(result.user);
      setIsAuthenticated(true);
      setSessionVersion((version) => version + 1);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Authentication failed. Please verify your credentials.';
      return { success: false, error: message };
    }
  };

  const registerAccount = async (
    fullName: string,
    email: string,
    password: string,
    targetRole: UserRole,
    facultyInviteCode?: string,
  ): Promise<{
    success: boolean;
    requiresEmailConfirmation?: boolean;
    error?: string;
  }> => {
    if (import.meta.env.VITE_DEMO_MODE === 'true') {
      return { success: false, error: 'Account registration is unavailable in demo mode.' };
    }
    if (!isSupabaseConfigured()) {
      return { success: false, error: 'Registration is not configured. Please contact your institution administrator.' };
    }

    try {
      if (targetRole === 'instructor') {
        await api.validateFacultyInvite(facultyInviteCode || '');
      }
      const { data, error } = await getSupabaseClient().auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            full_name: fullName.trim(),
            ...(targetRole === 'instructor' ? { requested_role: 'faculty' } : {}),
          },
          emailRedirectTo: window.location.origin,
        },
      });
      if (error) throw error;
      if (!data.session) {
        return {
          success: true,
          requiresEmailConfirmation: true,
        };
      }
      if (targetRole === 'instructor') {
        api.setToken(data.session.access_token);
        const registeredUser = await api.provisionSupabaseAccount(
          fullName.trim(),
          'instructor',
          facultyInviteCode,
        );
        if (registeredUser.role !== 'instructor') {
          throw new Error('The faculty account did not receive the expected role.');
        }
        setRole(targetRole);
        localStorage.setItem('sa_ai_role', targetRole);
        setUser(registeredUser);
        setIsAuthenticated(true);
        setSessionVersion((version) => version + 1);
        return { success: true };
      }
      api.setToken(data.session.access_token);
      const registeredUser = await api.provisionSupabaseAccount(fullName.trim());
      if (registeredUser.role !== 'student') {
        throw new Error('The new account was not assigned the student role.');
      }
      setRole(targetRole);
      localStorage.setItem('sa_ai_role', targetRole);
      setUser(registeredUser);
      setIsAuthenticated(true);
      setSessionVersion((version) => version + 1);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (/email-already-in-use|already exists|already registered/i.test(message)) {
        return { success: false, error: 'An account may already exist for this email. Try signing in or resetting your password.' };
      }
      if (/faculty invite code|faculty invitations/i.test(message)) {
        return { success: false, error: message };
      }
      api.logout(true);
      return {
        success: false,
        error: 'Your account could not be initialized. Check your Supabase configuration or contact support.',
      };
    }
  };

  const registerStudent = (
    fullName: string,
    email: string,
    password: string,
  ) => registerAccount(fullName, email, password, 'student');

  const registerFaculty = (
    fullName: string,
    email: string,
    password: string,
    inviteCode: string,
  ) => registerAccount(fullName, email, password, 'instructor', inviteCode);

  const completePasswordReset = async (password: string) => {
    if (!isSupabaseConfigured()) throw new Error('Password recovery is not configured.');
    const { data, error } = await getSupabaseClient().auth.updateUser({ password });
    if (error || !data.user) throw error || new Error('The password reset session is invalid or expired.');
    const { data: sessionData, error: sessionError } = await getSupabaseClient().auth.getSession();
    if (sessionError || !sessionData.session) throw sessionError || new Error('The password reset session is invalid or expired.');
    api.setToken(sessionData.session.access_token);
    window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
    const restoredUser = await api.getCurrentUser();
    setUser(restoredUser);
    setRole(restoredUser.role);
    setIsAuthenticated(true);
    setIsPasswordRecovery(false);
    setSessionVersion((version) => version + 1);
  };

  const switchRole = async (newRole: UserRole) => {
    if (newRole === role) return;
    isSigningOut.current = true;
    try {
      await api.logout();
    } finally {
      isSigningOut.current = false;
    }
    setIsAuthenticated(false);
    setRole(newRole);
    localStorage.setItem('sa_ai_role', newRole);
    setUser({ ...EMPTY_USER, role: newRole });
    setSessionVersion((version) => version + 1);
    window.location.hash = newRole === 'student' ? 'login/student' : 'login/faculty';
  };

  const resetAuthState = useCallback(() => {
    api.setToken(null);
    api.clearUserData();
    setIsAuthenticated(false);
    setSessionVersion((version) => version + 1);
    localStorage.removeItem('sa_ai_auth_token');
    localStorage.removeItem('sa_ai_role');
    setUser({ ...EMPTY_USER, role });
    window.location.hash = role === 'student' ? 'login/student' : 'login/faculty';
  }, [role]);

  const signOut = useCallback(async () => {
    isSigningOut.current = true;
    try {
      await api.logout();
    } finally {
      isSigningOut.current = false;
      resetAuthState();
    }
  }, [resetAuthState]);

  useEffect(() => {
    const handleUnauthorized = () => resetAuthState();
    window.addEventListener('sa-ai-unauthorized', handleUnauthorized);
    return () => window.removeEventListener('sa-ai-unauthorized', handleUnauthorized);
  }, [resetAuthState]);

  useEffect(() => {
    if (import.meta.env.VITE_DEMO_MODE === 'true') {
      let active = true;
      const token = api.getToken();
      if (!token) {
        setIsRestoringSession(false);
        return () => { active = false; };
      }
      api.getCurrentUser(roleAtMount.current).then((restoredUser) => {
        if (!active) return;
        setUser(restoredUser);
        setRole(restoredUser.role);
        setIsAuthenticated(true);
      }).catch(() => {
        if (!active) return;
        api.setToken(null);
        api.clearUserData();
      }).finally(() => {
        if (active) setIsRestoringSession(false);
      });
      return () => { active = false; };
    }

    if (!isSupabaseConfigured()) {
      setIsRestoringSession(false);
      return;
    }

    let active = true;
    const supabase = getSupabaseClient();
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (isSigningOut.current) return;
      if (event === 'PASSWORD_RECOVERY') setIsPasswordRecovery(true);
      queueMicrotask(async () => {
        if (!active) return;
        const nextUserId = session?.user.id ?? null;
        if (nextUserId !== authSessionUserId.current) {
          sessionGeneration.current += 1;
          authSessionUserId.current = nextUserId;
        }
        try {
          const token = session?.access_token ?? null;
          api.setToken(token);
          if (!session) {
            api.clearUserData();
            setIsAuthenticated(false);
            setIsPasswordRecovery(false);
            setUser((currentUser) => ({ ...EMPTY_USER, role: currentUser.role }));
            return;
          }
          const generationAtRestore = sessionGeneration.current;
          const restoredUser = await api.getCurrentUser();
          if (!active || generationAtRestore !== sessionGeneration.current ||
            authSessionUserId.current !== session.user.id) return;
          setUser(restoredUser);
          setRole(restoredUser.role);
          localStorage.setItem('sa_ai_role', restoredUser.role);
          setIsAuthenticated(true);
          setIsPasswordRecovery(false);
        } catch {
          if (!active) return;
          api.setToken(null);
          api.clearUserData();
          authSessionUserId.current = null;
          sessionGeneration.current += 1;
          setIsAuthenticated(false);
          setIsPasswordRecovery(false);
          setUser((currentUser) => ({ ...EMPTY_USER, role: currentUser.role }));
          localStorage.removeItem('sa_ai_role');
        } finally {
          if (active) setIsRestoringSession(false);
        }
      });
    });

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ user, role, isAuthenticated, isRestoringSession, isPasswordRecovery, sessionVersion, signIn, registerStudent, registerFaculty, completePasswordReset, switchRole, setUser, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
