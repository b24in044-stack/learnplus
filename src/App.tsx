/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { lazy, Suspense, useState, useEffect, useRef } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ApiStatusProvider } from './context/ApiStatusContext';
import { Sidebar, NavTab } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { CommandPalette } from './components/layout/CommandPalette';
import { NotificationDrawer } from './components/layout/NotificationDrawer';
import { LoginPage } from './components/auth/LoginPage';
import { RegistrationPage } from './components/auth/RegistrationPage';

import { Assessment, AssessmentResult, UserRole } from './types';
import { useAuthenticatedData } from './hooks/useAuthenticatedData';
import { ErrorState } from './components/ui/ErrorState';
import { EmptyState } from './components/ui/EmptyState';
import { BookOpen } from 'lucide-react';

const SettingsModal = lazy(() => import('./components/settings/SettingsModal').then(({ SettingsModal: component }) => ({ default: component })));
const StudentDashboard = lazy(() => import('./components/dashboard/StudentDashboard').then(({ StudentDashboard: component }) => ({ default: component })));
const CourseList = lazy(() => import('./components/courses/CourseList').then(({ CourseList: component }) => ({ default: component })));
const CourseDetail = lazy(() => import('./components/courses/CourseDetail').then(({ CourseDetail: component }) => ({ default: component })));
const AITutorWorkspace = lazy(() => import('./components/tutor/AITutorWorkspace').then(({ AITutorWorkspace: component }) => ({ default: component })));
const StudyMaterials = lazy(() => import('./components/materials/StudyMaterials').then(({ StudyMaterials: component }) => ({ default: component })));
const AssessmentList = lazy(() => import('./components/assessments/AssessmentList').then(({ AssessmentList: component }) => ({ default: component })));
const QuizRunner = lazy(() => import('./components/assessments/QuizRunner').then(({ QuizRunner: component }) => ({ default: component })));
const QuizResultsView = lazy(() => import('./components/assessments/QuizResultsView').then(({ QuizResultsView: component }) => ({ default: component })));
const AssignmentGenerationWorkspace = lazy(() => import('./components/assessments/AssignmentGenerationWorkspace').then(({ AssignmentGenerationWorkspace: component }) => ({ default: component })));
const LearningAgentWorkspace = lazy(() => import('./components/learning-agent/LearningAgentWorkspace').then(({ LearningAgentWorkspace: component }) => ({ default: component })));
const LearningAnalytics = lazy(() => import('./components/analytics/LearningAnalytics').then(({ LearningAnalytics: component }) => ({ default: component })));
const PersonalizedLearningPath = lazy(() => import('./components/learning-path/PersonalizedLearningPath').then(({ PersonalizedLearningPath: component }) => ({ default: component })));
const InstructorWorkspace = lazy(() => import('./components/instructor/InstructorWorkspace').then(({ InstructorWorkspace: component }) => ({ default: component })));
const AdminWorkspace = lazy(() => import('./components/admin/AdminWorkspace').then(({ AdminWorkspace: component }) => ({ default: component })));
const StudyPlanner = lazy(() => import('./components/planner/StudyPlanner').then(({ StudyPlanner: component }) => ({ default: component })));
const CodingLab = lazy(() => import('./components/lab/CodingLab').then(({ CodingLab: component }) => ({ default: component })));
const AttendanceWorkspace = lazy(() => import('./components/academic/AttendanceWorkspace').then(({ AttendanceWorkspace: component }) => ({ default: component })));
const ProjectResearchWorkspace = lazy(() => import('./components/academic/ProjectResearchWorkspace').then(({ ProjectResearchWorkspace: component }) => ({ default: component })));

function MainApp() {
  const { role, isAuthenticated, isRestoringSession, isPasswordRecovery, user, sessionVersion } = useAuth();
  const [currentTab, setCurrentTab] = useState<NavTab>('dashboard');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isNotificationDrawerOpen, setIsNotificationDrawerOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const lastAdminTab = useRef<NavTab>('admin');

  // Authentication routing check
  const [isLoginRoute, setIsLoginRoute] = useState<boolean>(() => {
    const hash = window.location.hash;
    return !isAuthenticated || hash.includes('login/');
  });
  const [isRegistrationRoute, setIsRegistrationRoute] = useState<boolean>(() =>
    window.location.hash.replace('#', '').replace(/^\//, '').startsWith('register')
  );

  const [loginRole, setLoginRole] = useState<UserRole>(() => {
    if (window.location.hash.includes('admin')) return 'admin';
    return window.location.hash.includes('faculty') ? 'instructor' : 'student';
  });

  // Global course & assessment state
  const { courses, assessments, isLoading: isLoadingUserData, error: userDataError, retry: retryUserData } = useAuthenticatedData();
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);

  // Active quiz runner state
  const [activeQuiz, setActiveQuiz] = useState<Assessment | null>(null);
  const [quizResult, setQuizResult] = useState<AssessmentResult | null>(null);

  // Navigation query parameter (for AI tutor or course deep-links)
  const [tutorQuery, setTutorQuery] = useState<string>('');

  useEffect(() => {
    setSelectedCourseId(null);
    setActiveQuiz(null);
    setQuizResult(null);
  }, [sessionVersion, role, user.id]);

  // Sync tab with URL hash for browser back/forward and refresh durability
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace('#', '').replace(/^\//, '');

      if (hash.startsWith('register') && !isAuthenticated) {
        setIsLoginRoute(true);
        setIsRegistrationRoute(true);
        return;
      }
      setIsRegistrationRoute(false);
      if (hash.startsWith('register')) {
        setIsLoginRoute(false);
        const homeTab: NavTab = role === 'admin'
          ? 'admin'
          : role === 'instructor'
            ? 'instructor'
            : 'dashboard';
        setCurrentTab(homeTab);
        window.history.replaceState(
          null,
          document.title,
          `${window.location.pathname}${window.location.search}#${homeTab}`
        );
        return;
      }

      if (hash.startsWith('login/faculty')) {
        setIsLoginRoute(true);
        setLoginRole('instructor');
        return;
      }
      if (hash.startsWith('login/admin')) {
        setIsLoginRoute(true);
        setLoginRole('admin');
        return;
      }
      if (hash.startsWith('login/student') || hash === 'login') {
        setIsLoginRoute(true);
        setLoginRole('student');
        return;
      }

      // Admin tools use their own routes; Inbox and Settings remain overlays.
      if (role === 'admin') {
        const adminTabs: NavTab[] = ['admin', 'attendance', 'projects'];
        if (hash === 'inbox' || hash === 'settings') {
          setIsLoginRoute(false);
          setIsNotificationDrawerOpen(hash === 'inbox');
          setIsSettingsOpen(hash === 'settings');
          setCurrentTab(lastAdminTab.current);
          return;
        }
        if (adminTabs.includes(hash as NavTab)) {
          const adminTab = hash as NavTab;
          lastAdminTab.current = adminTab;
          setCurrentTab(adminTab);
          setIsLoginRoute(false);
          setIsNotificationDrawerOpen(false);
          setIsSettingsOpen(false);
          return;
        }
        setCurrentTab('admin');
        lastAdminTab.current = 'admin';
        setIsLoginRoute(false);
        setIsNotificationDrawerOpen(false);
        setIsSettingsOpen(false);
        window.history.replaceState(
          null,
          document.title,
          `${window.location.pathname}${window.location.search}#admin`
        );
        return;
      }

      if (hash === 'materials' && role !== 'instructor') {
        setCurrentTab('dashboard');
        window.history.replaceState(
          null,
          document.title,
          `${window.location.pathname}${window.location.search}#dashboard`
        );
        return;
      }

      if (['assignment-agent', 'learning-agent'].includes(hash) && role !== 'student') {
        const homeTab = role === 'instructor' ? 'instructor' : 'dashboard';
        setCurrentTab(homeTab);
        window.history.replaceState(
          null,
          document.title,
          `${window.location.pathname}${window.location.search}#${homeTab}`
        );
        return;
      }

      if (hash === 'admin') {
        const fallbackTab = role === 'instructor' ? 'instructor' : 'dashboard';
        setCurrentTab(fallbackTab);
        window.history.replaceState(
          null,
          document.title,
          `${window.location.pathname}${window.location.search}#${fallbackTab}`
        );
        return;
      }

      // If not authenticated, force login route
      if (!isAuthenticated) {
        setIsLoginRoute(true);
        return;
      }

      setIsLoginRoute(false);

      const validTabs: NavTab[] = [
        'dashboard',
        'courses',
        'tutor',
        'materials',
        'assessments',
        'assignment-agent',
        'learning-agent',
        'analytics',
        'learning-path',
        'planner',
        'attendance',
        'projects',
        'lab',
        'instructor',
        'admin',
        'settings'
      ];

      if (validTabs.includes(hash as NavTab)) {
        setCurrentTab(hash as NavTab);
      }
    };

    handleHashChange();

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [isAuthenticated, role]);

  const handleNavigate = (
    tab: NavTab,
    params?: { courseId?: string; assessmentId?: string; topicQuery?: string }
  ) => {
    if (tab === 'materials' && role !== 'instructor') return;
    if (['assignment-agent', 'learning-agent'].includes(tab) && role !== 'student') return;
    if (params?.courseId) {
      setSelectedCourseId(params.courseId);
    }
    if (params?.topicQuery) {
      setTutorQuery(params.topicQuery);
    }
    if (params?.assessmentId) {
      const targetAsmt = assessments.find((a) => a.id === params.assessmentId);
      if (targetAsmt) {
        setActiveQuiz(targetAsmt);
        setQuizResult(null);
        setCurrentTab('assessments');
        window.location.hash = 'assessments';
        return;
      }
    }

    // Reset quiz active states when navigating elsewhere
    if (tab !== 'assessments') {
      setActiveQuiz(null);
      setQuizResult(null);
    }

    setCurrentTab(tab);
    window.location.hash = tab;
    setIsMobileMenuOpen(false);
  };

  const openNotifications = () => {
    if (role === 'admin') {
      window.location.hash = 'inbox';
      return;
    }
    setIsNotificationDrawerOpen(true);
  };

  const openSettings = () => {
    if (role === 'admin') {
      window.location.hash = 'settings';
      return;
    }
    setIsSettingsOpen(true);
  };

  const closeAdminOverlay = (overlay: 'inbox' | 'settings') => {
    if (role !== 'admin' || window.location.hash !== `#${overlay}`) return;
    const returnTab = lastAdminTab.current;
    setCurrentTab(returnTab);
    setIsNotificationDrawerOpen(false);
    setIsSettingsOpen(false);
    window.history.replaceState(
      null,
      document.title,
      `${window.location.pathname}${window.location.search}#${returnTab}`
    );
  };

  const getPageTitle = () => {
    switch (currentTab) {
      case 'dashboard':
        return 'Overview Dashboard';
      case 'courses':
        return selectedCourseId ? 'Course Details' : 'Enrolled Courses';
      case 'tutor':
        return 'Academic AI Tutor';
      case 'materials':
        return 'Study Materials';
      case 'assessments':
        return activeQuiz ? 'Assessment in Progress' : quizResult ? 'Assessment Results' : 'Assessments & Quizzes';
      case 'assignment-agent':
        return 'Assignment Generation Agent';
      case 'learning-agent':
        return 'Learning Agent';
      case 'analytics':
        return 'Learning Analytics';
      case 'learning-path':
        return 'Personalized Learning Path';
      case 'lab':
        return 'Coding Practice Lab';
      case 'planner':
        return 'Study Planner & Calendar';
      case 'attendance':
        return 'Attendance';
      case 'projects':
        return 'Projects & Research';
      case 'instructor':
        return 'Faculty Portal & Agent Telemetry';
      case 'admin':
        return 'Course Management';
      case 'settings':
        return 'Settings & API Configuration';
      default:
        return 'Student Agent AI';
    }
  };

  if (isRestoringSession) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-[#64748B]" role="status">Restoring your session…</div>;
  }

  // If user is on a login route or unauthenticated, show the dedicated LoginPage
  if (isRegistrationRoute && !isAuthenticated && !isPasswordRecovery) {
    return (
      <RegistrationPage
        initialRole={loginRole}
        onSignIn={(signInRole) => {
          setLoginRole(signInRole);
          window.location.hash = signInRole === 'instructor' ? 'login/faculty' : 'login/student';
        }}
        onSuccess={(registeredRole) => {
          setIsRegistrationRoute(false);
          setIsLoginRoute(false);
          setIsMobileMenuOpen(false);
          const tab = registeredRole === 'admin' ? 'admin' : registeredRole === 'instructor' ? 'instructor' : 'dashboard';
          setCurrentTab(tab);
          window.location.hash = tab;
        }}
      />
    );
  }

  if (isPasswordRecovery || (isLoginRoute && !isRegistrationRoute) || (!isAuthenticated && !isRegistrationRoute)) {
    return (
      <LoginPage
        initialRole={loginRole}
        onRegister={() => { window.location.hash = 'register'; }}
        onSuccess={(authedRole) => {
          setIsLoginRoute(false);
          setIsMobileMenuOpen(false);
          const tab = authedRole === 'admin' ? 'admin' : authedRole === 'instructor' ? 'instructor' : 'dashboard';
          setCurrentTab(tab);
          window.location.hash = tab;
        }}
      />
    );
  }

  const selectedCourse = courses.find((c) => c.id === selectedCourseId) || null;

  return (
    <div className={`app-shell ${isSidebarCollapsed ? 'sidebar-is-collapsed' : ''}`}>
      {/* Desktop & Mobile Collapsible Sidebar */}
      {isMobileMenuOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setIsMobileMenuOpen(false)}
          className="fixed inset-0 z-20 bg-slate-900/40 md:hidden"
        />
      )}
      <Sidebar
        currentTab={currentTab}
        onSelectTab={(tab) => handleNavigate(tab)}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        onOpenSettings={() => {
          openSettings();
          setIsMobileMenuOpen(false);
        }}
        onOpenNotifications={() => {
          openNotifications();
          setIsMobileMenuOpen(false);
        }}
        isMobileOpen={isMobileMenuOpen}
      />

      {/* Main Content Viewport */}
      <div className="app-workspace">
        <Header
          pageTitle={getPageTitle()}
          isDashboard={currentTab === 'dashboard'}
          courses={courses}
          onNavigate={(tab, params) => handleNavigate(tab, params)}
          onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
          onOpenNotifications={openNotifications}
          onOpenSettings={openSettings}
          onToggleMobileMenu={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        />

        <main className="app-main">
          <Suspense fallback={<div className="p-8 text-center text-sm text-[#64748B]" role="status">Loading page…</div>}>
          {currentTab === 'dashboard' && (
            <StudentDashboard
              onNavigate={(tab, params) => handleNavigate(tab, params)}
            />
          )}

          {currentTab === 'courses' && (
            userDataError ? (
              <ErrorState message={userDataError} onRetry={retryUserData} className="mt-12" />
            ) : isLoadingUserData ? (
              <div className="p-8 text-center text-sm text-[#64748B]" role="status">Loading your courses…</div>
            ) : courses.length === 0 ? (
              <EmptyState icon={<BookOpen className="w-5 h-5" />} title="No courses available" description="Your courses will appear here when they are assigned to your account." />
            ) : (
              <>
              {selectedCourse ? (
                <CourseDetail
                  course={selectedCourse}
                  onBack={() => setSelectedCourseId(null)}
                  onNavigate={(tab, params) => handleNavigate(tab, params)}
                />
              ) : (
                <CourseList
                  courses={courses}
                  onSelectCourse={(c) => setSelectedCourseId(c.id)}
                />
              )}
              </>
            )
          )}

          {currentTab === 'tutor' && (
            <AITutorWorkspace
              initialQuery={tutorQuery}
              courses={courses}
              activeCourseId={selectedCourseId}
            />
          )}

          {currentTab === 'materials' && (
            <StudyMaterials
              courses={courses}
            />
          )}

          {currentTab === 'assessments' && (
            userDataError ? (
              <ErrorState message={userDataError} onRetry={retryUserData} className="mt-12" />
            ) : isLoadingUserData ? (
              <div className="p-8 text-center text-sm text-[#64748B]" role="status">Loading your assessments…</div>
            ) : assessments.length === 0 ? (
              <EmptyState icon={<BookOpen className="w-5 h-5" />} title="No assessments available" description="Assessments assigned to your courses will appear here." />
            ) : (
              <>
              {activeQuiz ? (
                <QuizRunner
                  assessment={activeQuiz}
                  onCancel={() => {
                    setActiveQuiz(null);
                    setQuizResult(null);
                  }}
                  onComplete={(res) => {
                    setActiveQuiz(null);
                    setQuizResult(res);
                  }}
                />
              ) : quizResult ? (
                <QuizResultsView
                  result={quizResult}
                  onRetake={() => {
                    const asmt = assessments.find((a) => a.id === quizResult.assessmentId);
                    if (asmt) {
                      setQuizResult(null);
                      setActiveQuiz(asmt);
                    }
                  }}
                  onNavigate={(tab, params) => handleNavigate(tab, params)}
                />
              ) : (
                <AssessmentList
                  courses={courses}
                  onNavigate={(tab, params) => handleNavigate(tab, params)}
                  onStartQuiz={(asmt) => {
                    setQuizResult(null);
                    setActiveQuiz(asmt);
                  }}
                />
              )}
              </>
            )
          )}

          {currentTab === 'assignment-agent' && role === 'student' && (
            <AssignmentGenerationWorkspace
              courses={courses}
              onNavigate={(tab, params) => handleNavigate(tab, params)}
              onBack={() => handleNavigate('assessments')}
            />
          )}

          {currentTab === 'learning-agent' && role === 'student' && (
            <LearningAgentWorkspace
              onNavigate={(tab, params) => handleNavigate(tab, params)}
            />
          )}

          {currentTab === 'analytics' && (
            <LearningAnalytics
              courses={courses}
              onNavigate={(tab, params) => handleNavigate(tab, params)}
            />
          )}

          {currentTab === 'learning-path' && (
            <PersonalizedLearningPath
              courses={courses}
              activeCourseId={selectedCourseId}
              onNavigate={(tab, params) => handleNavigate(tab, params)}
            />
          )}

          {currentTab === 'planner' && (
            <StudyPlanner
              courses={courses}
              onNavigate={(tab, params) => handleNavigate(tab, params)}
            />
          )}

          {currentTab === 'attendance' && <AttendanceWorkspace courses={courses} />}
          {currentTab === 'projects' && <ProjectResearchWorkspace />}

          {currentTab === 'lab' && (
            <CodingLab
              onNavigate={(tab, params) => handleNavigate(tab, params)}
            />
          )}

          {currentTab === 'instructor' && (
            <InstructorWorkspace courses={courses} />
          )}

          {currentTab === 'admin' && role === 'admin' && <AdminWorkspace />}

          {currentTab === 'settings' && (
            <div className="p-8 max-w-4xl mx-auto space-y-4">
              <div className="bg-white border border-[#E2E8F0] rounded-xl p-6 shadow-xs space-y-4">
                <h2 className="text-base font-bold text-[#0F172A]">Platform Configuration</h2>
                <p className="text-xs text-[#64748B]">
                  Manage backend connectivity and academic session settings.
                </p>
                <button
                  onClick={() => setIsSettingsOpen(true)}
                  className="px-4 py-2 bg-[#4338CA] text-white rounded-lg text-xs font-semibold hover:bg-[#3730A3] transition-colors cursor-pointer"
                >
                  Configure API & Agent Telemetry
                </button>
              </div>
            </div>
          )}
          </Suspense>
        </main>
      </div>

      {/* Global Overlays & Modals */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        onNavigate={(tab, params) => handleNavigate(tab, params)}
        courses={courses}
        assessments={assessments}
        role={role}
      />

      <NotificationDrawer
        isOpen={isNotificationDrawerOpen}
        onClose={() => {
          if (role === 'admin') closeAdminOverlay('inbox');
          else setIsNotificationDrawerOpen(false);
        }}
        onNavigate={(tab) => handleNavigate(tab)}
      />

      {isSettingsOpen && (
        <Suspense fallback={null}>
          <SettingsModal
            isOpen={isSettingsOpen}
            onClose={() => {
              if (role === 'admin') closeAdminOverlay('settings');
              else setIsSettingsOpen(false);
            }}
          />
        </Suspense>
      )}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ApiStatusProvider>
        <MainApp />
      </ApiStatusProvider>
    </AuthProvider>
  );
}
