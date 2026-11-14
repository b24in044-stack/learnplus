import React, { useEffect, useState } from 'react';
import { FlaskConical, FolderKanban } from 'lucide-react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';

export const ProjectResearchWorkspace: React.FC = () => {
  const { role, user } = useAuth();
  const [projects, setProjects] = useState<Array<Record<string, unknown>>>([]);
  const [workspaces, setWorkspaces] = useState<Array<Record<string, unknown>>>([]);
  const [title, setTitle] = useState('');
  const [abstract, setAbstract] = useState('');
  const [topic, setTopic] = useState('');
  const [problemStatement, setProblemStatement] = useState('');
  const [selectedProject, setSelectedProject] = useState<Record<string, unknown> | null>(null);
  const [members, setMembers] = useState<Array<Record<string, unknown>>>([]);
  const [memberId, setMemberId] = useState('');
  const [milestoneTitle, setMilestoneTitle] = useState('');
  const [milestoneDescription, setMilestoneDescription] = useState('');
  const [documentType, setDocumentType] = useState<'progress' | 'final_report' | 'supporting'>('progress');
  const [reviewDecision, setReviewDecision] = useState('feedback');
  const [reviewContent, setReviewContent] = useState('');
  const [researchPlan, setResearchPlan] = useState<Record<string, unknown> | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const load = async () => {
    try { setProjects(await api.getProjects()); setWorkspaces(await api.getResearchWorkspaces()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Projects and research could not be loaded.'); }
  };
  useEffect(() => { void load(); }, [role]);
  const createProject = async () => {
    try { await api.createProject({ title, abstract, description: abstract }); setTitle(''); setAbstract(''); setMessage('Project registered.'); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Project could not be registered.'); }
  };
  const createResearch = async () => {
    try { await api.createResearchWorkspace({ title: topic || 'Research workspace', topic, problemStatement }); setTopic(''); setProblemStatement(''); setMessage('Research workspace created. AI suggestions must be verified against real sources.'); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Research workspace could not be created.'); }
  };
  const generatePlan = async () => {
    try { const result = await api.generateResearchPlan(topic, problemStatement); setResearchPlan((result.data as Record<string, unknown>) || result); setMessage('AI research plan generated. Verify all literature independently.'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Research planning is unavailable.'); }
  };
  const openProject = async (projectId: string) => {
    try {
      const [project, projectMembers] = await Promise.all([api.getProject(projectId), api.getProjectMembers(projectId)]);
      setSelectedProject(project);
      setMembers(projectMembers);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Project details could not be loaded.'); }
  };
  const addMember = async () => {
    if (!selectedProject?.id || !memberId.trim()) return;
    try {
      const member = await api.addProjectMember(String(selectedProject.id), memberId.trim());
      setMembers((current) => [...current, member]);
      setMemberId('');
      setMessage('Team member added.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Team member could not be added.'); }
  };
  const removeMember = async (studentId: string) => {
    if (!selectedProject?.id) return;
    try {
      await api.removeProjectMember(String(selectedProject.id), studentId);
      setMembers((current) => current.filter((member) => String(member.student_id) !== studentId));
      setMessage('Team member removed.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Team member could not be removed.'); }
  };
  const createMilestone = async () => {
    if (!selectedProject?.id) return;
    try {
      const details = await api.createProjectMilestone(String(selectedProject.id), { title: milestoneTitle, description: milestoneDescription });
      setSelectedProject((current) => current ? { ...current, milestones: [...((current.milestones as Array<Record<string, unknown>>) || []), details] } : current);
      setMilestoneTitle(''); setMilestoneDescription(''); setMessage('Milestone created.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Milestone could not be created.'); }
  };
  const uploadDocument = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !selectedProject?.id) return;
    try { await api.uploadProjectDocument(String(selectedProject.id), file, documentType); setMessage('Private project document uploaded.'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Document upload failed.'); }
    event.target.value = '';
  };
  const reviewProject = async () => {
    if (!selectedProject?.id || !reviewContent.trim()) return;
    try {
      await api.reviewProject(String(selectedProject.id), reviewDecision, reviewContent.trim());
      setReviewContent('');
      setMessage('Project review saved.');
      await load();
      await openProject(String(selectedProject.id));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Project review could not be saved.'); }
  };
  return <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-5">
    <header><p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Academic work</p><h1 className="mt-1 text-xl font-bold text-slate-900">Projects and research</h1><p className="mt-1 text-sm text-slate-600">Workspace data is institution-scoped. Research suggestions are clearly unverified until you add authoritative sources.</p></header>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}{message && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{message}</p>}
    {role === 'student' && <div className="grid gap-5 md:grid-cols-2"><Card className="space-y-3 p-5"><h2 className="flex items-center gap-2 font-semibold"><FolderKanban size={17} /> Register project</h2><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Project title" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /><textarea value={abstract} onChange={(event) => setAbstract(event.target.value)} placeholder="Abstract and description" rows={5} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /><Button type="button" onClick={createProject}>Register project</Button></Card><Card className="space-y-3 p-5"><h2 className="flex items-center gap-2 font-semibold"><FlaskConical size={17} /> Research planning</h2><input value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="Research topic" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /><textarea value={problemStatement} onChange={(event) => setProblemStatement(event.target.value)} placeholder="Problem statement" rows={5} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /><div className="flex gap-2"><Button type="button" onClick={createResearch}>Create workspace</Button><Button type="button" variant="outline" onClick={generatePlan}>Generate AI outline</Button></div></Card></div>}
    {researchPlan && <Card className="space-y-2 p-5"><h2 className="font-semibold">AI-generated research outline</h2><p className="text-xs text-amber-700">{String(researchPlan.notice || 'Source verification required.')}</p><p className="text-sm text-slate-700">{String(researchPlan.problem_statement || '')}</p><p className="text-sm text-slate-600">Objectives: {Array.isArray(researchPlan.objectives) ? researchPlan.objectives.join(' · ') : ''}</p><p className="text-sm text-slate-600">Suggested milestones: {Array.isArray(researchPlan.milestones) ? researchPlan.milestones.join(' · ') : ''}</p></Card>}
    <div className="grid gap-5 md:grid-cols-2"><Card className="p-5"><h2 className="mb-3 font-semibold">Projects</h2>{!projects.length ? <p className="text-sm text-slate-600">No projects available.</p> : projects.map((project) => <button type="button" onClick={() => openProject(String(project.id))} key={String(project.id)} className="block w-full border-b border-slate-100 py-2 text-left text-sm hover:bg-slate-50"><strong>{String(project.title)}</strong><span className="ml-2 text-slate-500">{String(project.status)}</span></button>)}</Card><Card className="p-5"><h2 className="mb-3 font-semibold">Research workspaces</h2>{!workspaces.length ? <p className="text-sm text-slate-600">No research workspaces available.</p> : workspaces.map((workspace) => <div key={String(workspace.id)} className="border-b border-slate-100 py-2 text-sm"><strong>{String(workspace.title)}</strong><span className="ml-2 text-slate-500">{String(workspace.status)}</span></div>)}</Card></div>
    {selectedProject && <Card className="space-y-4 p-5"><div><h2 className="font-semibold">{String(selectedProject.title)}</h2><p className="text-sm text-slate-600">{String(selectedProject.description || '')}</p></div><div className="grid gap-3 md:grid-cols-3"><input value={milestoneTitle} onChange={(event) => setMilestoneTitle(event.target.value)} placeholder="Milestone title" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /><input value={milestoneDescription} onChange={(event) => setMilestoneDescription(event.target.value)} placeholder="Progress description" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /><Button type="button" onClick={createMilestone}>Add milestone</Button></div><div className="flex flex-wrap items-center gap-3"><select value={documentType} onChange={(event) => setDocumentType(event.target.value as typeof documentType)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="progress">Progress document</option><option value="final_report">Final report</option><option value="supporting">Supporting document</option></select><label className="cursor-pointer rounded-lg bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700">Upload private document<input type="file" accept=".pdf,.txt,.md" onChange={uploadDocument} className="hidden" /></label></div><div className="space-y-2">{((selectedProject.milestones as Array<Record<string, unknown>>) || []).map((milestone) => <div key={String(milestone.id)} className="rounded-lg border border-slate-200 p-3 text-sm"><strong>{String(milestone.title)}</strong><span className="ml-2 text-slate-500">{String(milestone.status)}</span><p className="mt-1 text-slate-600">{String(milestone.description || '')}</p></div>)}</div></Card>}
    {selectedProject && <Card className="space-y-3 p-5"><h2 className="font-semibold">Team members</h2>{!members.length ? <p className="text-sm text-slate-600">No team members are available.</p> : members.map((member) => <div key={String(member.student_id)} className="flex items-center justify-between border-b border-slate-100 py-2 text-sm"><span>{String((member.profiles as Record<string, unknown> | undefined)?.email || member.student_id)}</span>{role === 'student' && selectedProject.created_by === user.id && member.student_id !== user.id && <Button type="button" variant="outline" onClick={() => void removeMember(String(member.student_id))}>Remove</Button>}</div>)}{role === 'student' && selectedProject.created_by === user.id && <div className="flex gap-2"><input value={memberId} onChange={(event) => setMemberId(event.target.value)} placeholder="Student UUID" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" /><Button type="button" onClick={() => void addMember()} disabled={!memberId.trim()}>Add member</Button></div>}</Card>}
    {selectedProject && (role === 'instructor' || role === 'admin') && <Card className="space-y-3 p-5"><h2 className="font-semibold">Project review</h2><div className="flex flex-wrap gap-3"><select value={reviewDecision} onChange={(event) => setReviewDecision(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="feedback">Feedback</option><option value="revision_requested">Request revision</option><option value="approved">Approve</option><option value="rejected">Reject</option></select><Button type="button" onClick={reviewProject} disabled={!reviewContent.trim()}>Save review</Button></div><textarea value={reviewContent} onChange={(event) => setReviewContent(event.target.value)} placeholder="Review feedback" rows={4} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></Card>}
  </div>;
};
