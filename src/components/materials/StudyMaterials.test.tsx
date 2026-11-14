// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StudyMaterials } from './StudyMaterials';
import { api } from '../../services/api';
import { Course, CourseMaterial } from '../../types';

const authState = vi.hoisted(() => ({ role: 'instructor' as 'instructor' | 'student' }));
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1', role: authState.role } }),
}));

const courses: Course[] = [{
  id: 'course-1',
  code: 'CS101',
  title: 'Programming',
  description: '',
  instructor: 'Faculty',
  semesterId: 'semester-1',
  credits: 3,
  progress: 0,
  topicsCount: 0,
  materialsCount: 0,
}];

const syllabus: CourseMaterial = {
  id: 'material-1',
  courseId: 'course-1',
  courseCode: 'CS101',
  title: 'Course outline',
  description: 'Topics and learning outcomes',
  category: 'syllabus',
  fileType: 'pdf',
  fileSizeBytes: 1200,
  uploadedAt: '2026-11-12T00:00:00.000Z',
  uploadedBy: 'Faculty',
  published: true,
};

describe('StudyMaterials categorized workflow', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    authState.role = 'instructor';
  });

  it('requires a category and supported file before uploading', async () => {
    vi.spyOn(api, 'getCourseMaterials').mockResolvedValue([]);
    const upload = vi.spyOn(api, 'uploadCourseMaterial').mockResolvedValue(syllabus);
    render(<StudyMaterials courses={courses} />);
    await screen.findByText('No course materials found');

    const form = screen.getByRole('button', { name: 'Upload File' }).closest('form');
    expect(form).not.toBeNull();
    fireEvent.change(screen.getByLabelText('Document title *'), { target: { value: 'Course outline' } });
    const file = new File(['%PDF-1.7'], 'course.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText(/^File/), { target: { files: [file] } });
    fireEvent.submit(form!);

    expect((await screen.findByRole('alert')).textContent).toMatch(/select a category/i);
    expect(upload).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('What are you uploading? *'), { target: { value: 'syllabus' } });
    fireEvent.submit(form!);
    await waitFor(() => expect(upload).toHaveBeenCalledWith('course-1', file, {
      title: 'Course outline',
      category: 'syllabus',
      description: '',
    }));
  });

  it('does not upload unsupported formats and allows retry after an upload error', async () => {
    vi.spyOn(api, 'getCourseMaterials').mockResolvedValue([]);
    const upload = vi.spyOn(api, 'uploadCourseMaterial')
      .mockRejectedValueOnce(new Error('Storage temporarily unavailable.'))
      .mockResolvedValueOnce(syllabus);
    render(<StudyMaterials courses={courses} />);
    await screen.findByText('No course materials found');

    fireEvent.change(screen.getByLabelText('Document title *'), { target: { value: 'Question paper' } });
    fireEvent.change(screen.getByLabelText('What are you uploading? *'), { target: { value: 'pyq' } });
    const fileInput = screen.getByLabelText(/^File/);
    fireEvent.change(fileInput, { target: { files: [new File(['slides'], 'slides.pptx')] } });
    fireEvent.submit(screen.getByRole('button', { name: 'Upload File' }).closest('form')!);
    expect((await screen.findByRole('alert')).textContent).toMatch(/PDF, TXT, or Markdown/i);
    expect(upload).not.toHaveBeenCalled();

    const pdf = new File(['%PDF-1.7'], 'paper.pdf', { type: 'application/pdf' });
    fireEvent.change(fileInput, { target: { files: [pdf] } });
    const form = screen.getByRole('button', { name: 'Upload File' }).closest('form')!;
    fireEvent.submit(form);
    expect((await screen.findByRole('alert')).textContent).toContain('Storage temporarily unavailable.');
    fireEvent.submit(form);
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
  });

  it('lets students filter authorized materials by category and does not show upload controls', async () => {
    authState.role = 'student';
    vi.spyOn(api, 'getCourseMaterials').mockResolvedValue([
      syllabus,
      { ...syllabus, id: 'material-2', title: 'Previous paper', category: 'pyq' },
    ]);
    render(<StudyMaterials courses={courses} />);
    expect(await screen.findByText('Course outline')).toBeTruthy();
    expect(screen.getByText('Previous paper')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Upload File' })).toBeNull();
    const materialCard = screen.getByText('Course outline').closest('article');
    expect(materialCard?.className.split(' ')).toContain('flex-col');
    expect(materialCard?.className.split(' ')).toContain('sm:flex-row');

    fireEvent.change(screen.getByLabelText('Filter by category'), { target: { value: 'pyq' } });
    expect(screen.queryByText('Course outline')).toBeNull();
    expect(screen.getByText('Previous paper')).toBeTruthy();
  });

  it('lets faculty process an uploaded course material for the existing AI tutor', async () => {
    vi.spyOn(api, 'getCourseMaterials').mockResolvedValue([{
      ...syllabus,
      documentId: 'document-1',
      documentStatus: 'UPLOADED',
    }]);
    const process = vi.spyOn(api, 'processDocument').mockResolvedValue({
      documentId: 'document-1',
      chunksCount: 2,
      status: 'ready',
    });
    render(<StudyMaterials courses={courses} />);
    await screen.findByText('Course outline');

    fireEvent.click(screen.getByRole('button', { name: 'Process for Tutor' }));
    await waitFor(() => expect(process).toHaveBeenCalledWith('document-1', 'course-1'));
  });

  it('saves category edits and deletes only after the faculty confirms', async () => {
    vi.spyOn(api, 'getCourseMaterials').mockResolvedValue([syllabus]);
    const update = vi.spyOn(api, 'updateCourseMaterial').mockResolvedValue({
      ...syllabus,
      category: 'course_pdf',
    });
    const remove = vi.spyOn(api, 'deleteCourseMaterial').mockResolvedValue();
    render(<StudyMaterials courses={courses} />);
    await screen.findByText('Course outline');

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'course_pdf' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith('material-1', {
      title: 'Course outline',
      description: 'Topics and learning outcomes',
      category: 'course_pdf',
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete material' }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('material-1'));
  });
});
