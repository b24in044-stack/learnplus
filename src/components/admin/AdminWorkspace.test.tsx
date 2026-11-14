// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminWorkspace } from './AdminWorkspace';

const { apiMocks } = vi.hoisted(() => ({
  apiMocks: {
    getAdminInstitutionSetup: vi.fn(),
    getAdminAcademicStructure: vi.fn(),
    getInstitutionStudents: vi.fn(),
    getUnassignedInstitutionUsers: vi.fn(),
    getAdminCourseAssignments: vi.fn(),
    getAdminOverview: vi.fn(),
    assignStudentBranch: vi.fn(),
    assignStudentsToCourse: vi.fn(),
  },
}));

vi.mock('../../services/api', () => ({ api: apiMocks }));
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ role: 'admin' }),
}));

const institutionId = 'c0170384-dcbf-4944-88cf-153db4d64f96';
const branchId = 'd37f94f2-fca4-46ce-a4cf-f9c8b2097e5d';
const studentId = '2a0c9aca-d030-4bb5-bab6-d544d6ab0997';

describe('admin student branch assignment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getAdminInstitutionSetup.mockResolvedValue({
      institutionId,
      canCreateInstitution: false,
      institutions: [],
    });
    apiMocks.getAdminAcademicStructure.mockResolvedValue({
      departments: [{ id: 'department-id', code: 'C24', name: 'Computer Science' }],
      branches: [{ id: branchId, department_id: 'department-id', code: 'C012', name: 'CSO' }],
    });
    apiMocks.getInstitutionStudents.mockResolvedValue([{
      id: studentId,
      email: 'student@example.test',
      isApproved: true,
      branchId,
    }]);
    apiMocks.getUnassignedInstitutionUsers.mockResolvedValue([]);
    apiMocks.getAdminCourseAssignments.mockResolvedValue({
      faculty: [],
      courses: [{ id: 'course-id', code: 'CS101', title: 'Intro to CS', instructorId: null, branchId: null }],
    });
    apiMocks.getAdminOverview.mockResolvedValue({
      students: 1,
      faculty: 0,
      departments: 1,
      courses: 1,
      activeEnrollments: 0,
    });
    apiMocks.assignStudentBranch.mockResolvedValue({
      enrolledCourseCount: 1,
      branchCourseCount: 1,
    });
    apiMocks.assignStudentsToCourse.mockResolvedValue({
      assignedCount: 1,
      alreadyEnrolledCount: 0,
    });
  });

  afterEach(() => cleanup());

  it('resubmits an existing branch selection to synchronize branch course enrollments', async () => {
    render(<AdminWorkspace />);

    const assignButton = await screen.findByRole('button', { name: 'Assign branch' });
    expect((screen.getByRole('combobox', { name: 'Branch for student@example.test' }) as HTMLSelectElement).value)
      .toBe(branchId);
    fireEvent.click(assignButton);

    await waitFor(() => {
      expect(apiMocks.assignStudentBranch).toHaveBeenCalledWith(institutionId, studentId, branchId);
    });
    expect((await screen.findByRole('status')).textContent).toMatch(/1 new course enrollment/);
  });

  it('assigns selected students directly to a course without requiring a branch', async () => {
    apiMocks.getAdminAcademicStructure.mockResolvedValue({ departments: [], branches: [] });
    render(<AdminWorkspace />);

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select student@example.test' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Course for selected students' }), {
      target: { value: 'course-id' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Assign selected students to course' }));

    await waitFor(() => {
      expect(apiMocks.assignStudentsToCourse).toHaveBeenCalledWith(institutionId, 'course-id', [studentId]);
    });
    expect((await screen.findByRole('status')).textContent)
      .toContain('1 student assigned to CS101; 0 already had an enrollment.');
  });
});
