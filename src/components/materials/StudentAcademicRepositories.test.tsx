// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { StudentAcademicRepositories } from './StudentAcademicRepositories';
import { api } from '../../services/api';

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'supabase-user-student' } }),
}));

describe('StudentAcademicRepositories', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows a real repository error instead of presenting it as an empty result', async () => {
    vi.spyOn(api, 'getStudentAcademicContext').mockResolvedValue({
      uid: 'supabase-user-student',
      subjects: [],
      enrollments: [],
    });
    vi.spyOn(api, 'getEducationalMaterials').mockRejectedValue(new Error('Academic data service unavailable.'));
    vi.spyOn(api, 'getPreviousQuestionPapers').mockResolvedValue([]);
    vi.spyOn(api, 'getOfficialAnswerKeys').mockResolvedValue([]);
    vi.spyOn(api, 'getVerifiedSubjectMarks').mockResolvedValue([]);
    vi.spyOn(api, 'getVerifiedSemesterResults').mockResolvedValue([]);

    render(<StudentAcademicRepositories />);

    expect(await screen.findByText('Repository unavailable')).toBeTruthy();
    expect(screen.getByText('Academic data service unavailable.')).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryAllByText('No published documents found')).toHaveLength(2);
    });
  });

  it('shows explicit empty states after a successful empty response', async () => {
    vi.spyOn(api, 'getStudentAcademicContext').mockResolvedValue({
      uid: 'supabase-user-student',
      subjects: [],
      enrollments: [],
    });
    vi.spyOn(api, 'getEducationalMaterials').mockResolvedValue([]);
    vi.spyOn(api, 'getPreviousQuestionPapers').mockResolvedValue([]);
    vi.spyOn(api, 'getOfficialAnswerKeys').mockResolvedValue([]);
    vi.spyOn(api, 'getVerifiedSubjectMarks').mockResolvedValue([]);
    vi.spyOn(api, 'getVerifiedSemesterResults').mockResolvedValue([]);

    render(<StudentAcademicRepositories />);

    expect(await screen.findAllByText('No published documents found')).toHaveLength(3);
    expect(screen.getAllByText('No verified marks available')).toHaveLength(1);
    expect(screen.getAllByText('No verified semester results available')).toHaveLength(1);
  });
});
