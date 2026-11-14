import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { Assessment, Course } from '../types';

type LoadState = {
  identity: string | null;
  courses: Course[];
  assessments: Assessment[];
  status: 'idle' | 'loading' | 'loaded' | 'error';
  error: string | null;
};

const INITIAL_STATE: LoadState = {
  identity: null,
  courses: [],
  assessments: [],
  status: 'idle',
  error: null,
};

export function useAuthenticatedData() {
  const { isAuthenticated, role, user, sessionVersion } = useAuth();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<LoadState>(INITIAL_STATE);
  const identity = isAuthenticated
    ? `${sessionVersion}:${role}:${user.id}:${user.email}`
    : null;

  useEffect(() => {
    if (!identity) {
      setState(INITIAL_STATE);
      return;
    }

    let active = true;
    if (role === 'admin') {
      setState({
        identity,
        courses: [],
        assessments: [],
        status: 'loaded',
        error: null,
      });
      return () => {
        active = false;
      };
    }

    setState({
      identity,
      courses: [],
      assessments: [],
      status: 'loading',
      error: null,
    });

    Promise.all([
      api.getCourses(),
      role === 'student' ? api.getAssessments() : Promise.resolve([]),
    ])
      .then(([courses, assessments]) => {
        if (active) {
          setState({ identity, courses, assessments, status: 'loaded', error: null });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setState({
            identity,
            courses: [],
            assessments: [],
            status: 'error',
            error: error instanceof Error
              ? error.message
              : 'Unable to load your courses and assessments.',
          });
        }
      });

    return () => {
      active = false;
    };
  }, [identity, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const currentState = state.identity === identity ? state : null;

  return {
    courses: currentState?.courses ?? [],
    assessments: currentState?.assessments ?? [],
    isLoading: Boolean(identity) && role !== 'admin' && (currentState?.status === 'loading' || !currentState),
    error: currentState?.error ?? null,
    retry,
  };
}
