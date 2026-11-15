// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { Course } from '../../types';
import { AttendanceWorkspace } from './AttendanceWorkspace';

vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../services/api', () => ({
  api: {
    getAttendance: vi.fn(),
    getAttendanceSummary: vi.fn(),
    getAttendanceBranches: vi.fn(),
    getAttendanceReport: vi.fn(),
    getAttendanceRoster: vi.fn(),
    previewAttendanceUpload: vi.fn(),
    createAttendanceSession: vi.fn(),
    getAttendanceSession: vi.fn(),
    saveAttendance: vi.fn(),
  },
}));

const course: Course = {
  id: 'course-1',
  code: 'CS 101',
  title: 'Foundations of Computing',
  description: '',
  instructor: 'Faculty Member',
  semesterId: 'semester-1',
  credits: 3,
  progress: 0,
  topicsCount: 0,
  materialsCount: 0,
};
const roster = [
  { student_id: 'student-1', studentCode: 'B24IN001', studentName: 'Alex Chen', email: 'alex@example.test' },
  { student_id: 'student-2', studentCode: 'B24IN002', studentName: 'Riya Shah', email: 'riya@example.test' },
];

describe('faculty attendance workspace', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('previews an upload, combines it with manual statuses, and saves the full roster', async () => {
    vi.mocked(useAuth).mockReturnValue({ role: 'instructor' } as ReturnType<typeof useAuth>);
    vi.mocked(api.getAttendance).mockResolvedValue([]);
    vi.mocked(api.getAttendanceRoster).mockResolvedValue(roster);
    vi.mocked(api.previewAttendanceUpload).mockResolvedValue({
      totalRows: 1,
      validCount: 1,
      invalidCount: 1,
      duplicateCount: 0,
      unknownCount: 0,
      rows: [
        { rowNumber: 2, studentId: 'student-1', studentCode: 'B24IN001', studentName: 'Alex Chen', email: 'alex@example.test', status: 'absent', issues: [] },
        { rowNumber: null, studentId: 'student-2', studentCode: 'B24IN002', studentName: 'Riya Shah', email: 'riya@example.test', status: '', issues: ['Student is missing from the attendance file.'] },
      ],
      validRecords: [{ studentId: 'student-1', status: 'absent' }],
    });
    vi.mocked(api.createAttendanceSession).mockResolvedValue({
      session: { id: 'session-1' },
      records: [],
    });

    render(<AttendanceWorkspace courses={[course]} />);
    await screen.findByText('No attendance sessions recorded.');
    fireEvent.click(screen.getByRole('button', { name: 'Load enrolled roster' }));
    await screen.findByText('Alex Chen');
    fireEvent.click(screen.getByRole('button', { name: 'Mark all present' }));
    fireEvent.change(screen.getByLabelText('Preview CSV/XLSX'), {
      target: { files: [new File(['Student ID,Status'], 'attendance.csv', { type: 'text/csv' })] },
    });
    await screen.findByLabelText('Upload preview');

    expect((screen.getByLabelText('Attendance status for Alex Chen') as HTMLSelectElement).value).toBe('absent');
    expect((screen.getByLabelText('Attendance status for Riya Shah') as HTMLSelectElement).value).toBe('present');
    fireEvent.click(screen.getByRole('button', { name: 'Save attendance' }));

    await waitFor(() => expect(api.createAttendanceSession).toHaveBeenCalledWith(
      'course-1',
      expect.any(String),
      'Lecture',
      [
        { studentId: 'student-1', status: 'absent' },
        { studentId: 'student-2', status: 'present' },
      ],
    ));
    expect(await screen.findByText('Attendance session and all student records saved successfully.')).toBeTruthy();
  });

  it('requires a correction reason before saving an existing session correction', async () => {
    vi.mocked(useAuth).mockReturnValue({ role: 'instructor' } as ReturnType<typeof useAuth>);
    vi.mocked(api.getAttendance).mockResolvedValue([{
      id: 'session-1',
      course_id: 'course-1',
      session_date: '2026-11-12',
      title: 'Period 1',
    }]);
    vi.mocked(api.getAttendanceSession).mockResolvedValue({
      session: {
        id: 'session-1',
        course_id: 'course-1',
        session_date: '2026-11-12',
        title: 'Period 1',
      },
      records: [{
        id: 'record-1',
        student_id: 'student-1',
        status: 'present',
        marked_at: '2026-11-12T10:00:00Z',
        studentCode: 'B24IN001',
        studentName: 'Alex Chen',
        email: 'alex@example.test',
      }],
      corrections: [],
    });
    vi.mocked(api.saveAttendance).mockResolvedValue();

    render(<AttendanceWorkspace courses={[course]} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Review / correct' }));
    await screen.findByDisplayValue('2026-11-12');
    fireEvent.change(screen.getByLabelText('Attendance status for Alex Chen'), { target: { value: 'absent' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save corrections' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Enter a reason');
    expect(api.saveAttendance).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('Required when saving this existing session'), {
      target: { value: 'Verified against the signed register.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save corrections' }));
    await waitFor(() => expect(api.saveAttendance).toHaveBeenCalledWith(
      'session-1',
      [{ studentId: 'student-1', status: 'absent' }],
      'Verified against the signed register.',
    ));
  });
});
