// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useAuth } from '../../context/AuthContext';
import { LoginPage } from './LoginPage';
import { RegistrationPage } from './RegistrationPage';

vi.mock('../../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));
vi.mock('../../services/api', () => ({
  api: { sendPasswordReset: vi.fn() },
}));
vi.mock('../../services/supabase', () => ({
  supabaseConfigurationStatus: {
    urlPresent: true,
    publishableKeyPresent: true,
  },
}));

const registerStudent = vi.fn();
const registerFaculty = vi.fn();
const signIn = vi.fn();

function fillRegistrationForm() {
  fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Jordan Lee' } });
  fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'jordan@example.edu' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secure-password' } });
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'secure-password' } });
}

describe('student registration UI', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_DEMO_MODE', 'false');
    registerStudent.mockReset();
    registerFaculty.mockReset();
    signIn.mockReset();
    vi.mocked(useAuth).mockReturnValue({
      registerStudent,
      registerFaculty,
      signIn,
      isPasswordRecovery: false,
      completePasswordReset: vi.fn(),
    } as unknown as ReturnType<typeof useAuth>);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it('shows a Create account link on the login page', () => {
    const onRegister = vi.fn();
    render(<LoginPage onSuccess={vi.fn()} onRegister={onRegister} />);

    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(onRegister).toHaveBeenCalledTimes(1);
  });

  it('auto-fills credentials accepted by the faculty demo account', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'true');
    signIn.mockResolvedValue({ success: true });
    const onSuccess = vi.fn();
    render(<LoginPage onSuccess={onSuccess} onRegister={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Faculty Portal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Auto-fill Dr. Elena Rostova' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign In to Faculty Portal' }));

    await waitFor(() => expect(signIn).toHaveBeenCalledWith(
      'elena.rostova@university.edu',
      'FacultyPass2026!',
      'instructor'
    ));
    expect(onSuccess).toHaveBeenCalledWith('instructor');
  });

  it('asks faculty applicants for an invite code at sign-in', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'false');
    render(<LoginPage onSuccess={vi.fn()} onRegister={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Faculty Portal' }));
    fireEvent.change(screen.getByPlaceholderText('faculty@university.edu'), { target: { value: 'faculty@example.edu' } });
    expect(screen.getByLabelText('Faculty invite code')).toBeTruthy();
  });

  it('validates required fields, email format, and the minimum password length', () => {
    render(<RegistrationPage onSignIn={vi.fn()} onSuccess={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Jordan Lee' } });
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'not-an-email' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'short' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'short' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Create student account' }).closest('form')!);

    expect(screen.getByRole('alert').textContent).toBe('Enter a valid email address.');
    expect(registerStudent).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'jordan@example.edu' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Create student account' }).closest('form')!);
    expect(screen.getByRole('alert').textContent).toBe('Use a password with at least 8 characters.');
    expect(registerStudent).not.toHaveBeenCalled();
  });

  it('validates the password confirmation before requesting registration', () => {
    render(<RegistrationPage onSignIn={vi.fn()} onSuccess={vi.fn()} />);
    fillRegistrationForm();
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'different-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create student account' }));

    expect(screen.getByRole('alert').textContent).toBe('The passwords do not match.');
    expect(registerStudent).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Account type') as HTMLSelectElement).value).toBe('student');
  });

  it('submits a faculty registration with its invite code', async () => {
    registerFaculty.mockResolvedValue({ success: true });
    const onSuccess = vi.fn();
    render(<RegistrationPage onSignIn={vi.fn()} onSuccess={onSuccess} />);
    fireEvent.change(screen.getByLabelText('Account type'), { target: { value: 'instructor' } });
    fillRegistrationForm();
    fireEvent.change(screen.getByLabelText('Faculty invite code'), { target: { value: 'faculty-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create faculty account' }));

    await waitFor(() => expect(registerFaculty).toHaveBeenCalledWith(
      'Jordan Lee',
      'jordan@example.edu',
      'secure-password',
      'faculty-secret',
    ));
    expect(onSuccess).toHaveBeenCalledWith('instructor');
    expect(registerStudent).not.toHaveBeenCalled();
  });

  it('does not submit faculty registration without an invite code', () => {
    render(<RegistrationPage onSignIn={vi.fn()} onSuccess={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Account type'), { target: { value: 'instructor' } });
    fillRegistrationForm();
    fireEvent.submit(screen.getByRole('button', { name: 'Create faculty account' }).closest('form')!);

    expect(screen.getByRole('alert').textContent).toBe('Enter your faculty invite code.');
    expect(registerFaculty).not.toHaveBeenCalled();
  });

  it('asks a faculty applicant to sign in with the invite after email confirmation', async () => {
    registerFaculty.mockResolvedValue({
      success: true,
      requiresEmailConfirmation: true,
    });
    const onSignIn = vi.fn();
    render(<RegistrationPage onSignIn={onSignIn} onSuccess={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Account type'), { target: { value: 'instructor' } });
    fillRegistrationForm();
    fireEvent.change(screen.getByLabelText('Faculty invite code'), { target: { value: 'faculty-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create faculty account' }));

    expect((await screen.findByRole('status')).textContent).toMatch(/sign in to the Faculty Portal and enter your invite code/);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(onSignIn).toHaveBeenCalledWith('instructor');
  });

  it('reports email confirmation requirements without claiming the user is signed in', async () => {
    registerStudent.mockResolvedValue({ success: true, requiresEmailConfirmation: true });
    const onSuccess = vi.fn();
    const onSignIn = vi.fn();
    render(<RegistrationPage onSignIn={onSignIn} onSuccess={onSuccess} />);
    fillRegistrationForm();
    fireEvent.click(screen.getByRole('button', { name: 'Create student account' }));

    expect((await screen.findByRole('status')).textContent).toMatch(/Check jordan@example\.edu for a confirmation link/);
    expect(registerStudent).toHaveBeenCalledWith('Jordan Lee', 'jordan@example.edu', 'secure-password');
    expect(onSuccess).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it('shows registration errors safely and prevents duplicate submissions', async () => {
    let finishRegistration!: (result: { success: boolean; error?: string }) => void;
    registerStudent.mockReturnValue(new Promise((resolve) => { finishRegistration = resolve; }));
    render(<RegistrationPage onSignIn={vi.fn()} onSuccess={vi.fn()} />);
    fillRegistrationForm();
    const submit = screen.getByRole('button', { name: 'Create student account' });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(registerStudent).toHaveBeenCalledTimes(1);

    finishRegistration({ success: false, error: 'An account may already exist for this email.' });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/account may already exist/i));
  });

  it('displays an authentication failure without a success state', async () => {
    registerStudent.mockResolvedValue({
      success: false,
      error: 'We could not create your account. Check your details and try again.',
    });
    render(<RegistrationPage onSignIn={vi.fn()} onSuccess={vi.fn()} />);
    fillRegistrationForm();
    fireEvent.click(screen.getByRole('button', { name: 'Create student account' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/could not create your account/i);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
