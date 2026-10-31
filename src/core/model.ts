import { z } from 'zod';

export const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const frame = z.number().int().min(0).max(108000);
export const protectionSchema = z.enum(['timing', 'text', 'visual', 'audio']);
export type Protection = z.infer<typeof protectionSchema>;
export const clipSchema = z.object({
  id: idSchema, name: z.string().min(1).max(100),
  kind: z.enum(['card', 'video', 'image']).default('card'),
  assetId: idSchema.optional(), duration: frame.min(1).max(18000), sourceIn: frame.default(0),
  title: z.string().max(400).default(''), subtitle: z.string().max(600).default(''),
  kicker: z.string().max(80).default(''), layout: z.enum(['title', 'split', 'quote']).default('title'),
  background: color.default('#11151d'), accent: color.default('#ff9b62'),
  color: color.default('#ffffff'), fontSize: z.number().min(16).max(200).default(80),
  x: z.number().min(0).max(1).default(0.08), y: z.number().min(0).max(1).default(0.28),
  volume: z.number().min(0).max(2).default(1), scale: z.number().min(1).max(3).default(1),
  protected: z.array(protectionSchema).default([]),
}).strict();
export type Clip = z.infer<typeof clipSchema>;
export const voiceSchema = z.object({
  assetId:idSchema, text:z.string().min(1).max(500), durationFrames:frame.min(1),
  voiceLabel:z.string().min(1).max(160), guidance:z.string().max(1000).default(''),
  volume:z.number().min(0).max(2).default(1),
}).strict();
export type VoiceTake = z.infer<typeof voiceSchema>;
export const captionSchema = z.object({
  id: idSchema, clipId: idSchema, start: frame, end: frame.min(1), text: z.string().min(1).max(500),
  y: z.number().min(0.05).max(0.95).default(0.85), fontSize: z.number().min(16).max(120).default(42),
  color: color.default('#ffffff'),
  voice:voiceSchema.nullable().optional(),
}).strict();
export type Caption = z.infer<typeof captionSchema>;
export const briefSchema = z.object({
  audience: z.string().max(500).default(''), goal: z.string().max(1000).default(''),
  tone: z.string().max(500).default('清晰、克制'), recipe: z.enum(['tutorial', 'product', 'story']).default('product'),
}).strict();
export const compositionSchema = z.object({
  title: z.string().min(1).max(120), fps: z.literal(30).default(30),
  width: z.union([z.literal(1920), z.literal(1080)]).default(1920),
  height: z.union([z.literal(1080), z.literal(1920)]).default(1080),
  brief: briefSchema.default({}), clips: z.array(clipSchema).min(1).max(80),
  captions: z.array(captionSchema).max(1000).default([]),
  music: z.object({ assetId: idSchema, volume: z.number().min(0).max(1).default(0.15) }).strict().nullable().default(null),
  musicProtected: z.boolean().default(false),
}).strict();
export type Composition = z.infer<typeof compositionSchema>;

const clipPatch = clipSchema.omit({ id: true, protected: true, kind: true }).partial();
export const operationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('update_clip'), id: idSchema, patch: clipPatch }).strict(),
  z.object({ type: z.literal('insert_clip'), afterId: idSchema.optional(), clip: clipSchema }).strict(),
  z.object({ type: z.literal('remove_clip'), id: idSchema }).strict(),
  z.object({ type: z.literal('move_clip'), id: idSchema, toIndex: z.number().int().min(0).max(79) }).strict(),
  z.object({ type: z.literal('split_clip'), id: idSchema, at: frame.min(1), newId: idSchema }).strict(),
  z.object({ type: z.literal('add_caption'), caption: captionSchema }).strict(),
  z.object({ type: z.literal('update_caption'), id: idSchema, patch: captionSchema.omit({ id: true, clipId: true, voice:true }).partial() }).strict(),
  z.object({ type:z.literal('set_caption_voice'),id:idSchema,voice:voiceSchema.nullable() }).strict(),
  z.object({ type: z.literal('remove_caption'), id: idSchema }).strict(),
  z.object({ type: z.literal('set_music'), music: compositionSchema.shape.music }).strict(),
  z.object({ type: z.literal('protect_music'), value: z.boolean() }).strict(),
  z.object({ type: z.literal('protect_clip'), id: idSchema, fields: z.array(protectionSchema) }).strict(),
]);
export type Operation = z.infer<typeof operationSchema>;
export interface Asset { id: string; name: string; kind: 'video' | 'image' | 'audio'; file: string; mime: string; bytes: number; durationFrames?: number }
export interface Revision { number: number; createdAt: string; actor: 'agent' | 'human'; label: string; composition: Composition;operations?:Operation[] }
export const feedbackInput = z.object({
  clipId: idSchema, captionId: idSchema.optional(), offset: frame, endOffset: frame.optional(),
  region: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().min(0).max(1), height: z.number().min(0).max(1) }).strict().optional(),
  text: z.string().trim().min(1).max(3000), category: z.enum(['pacing', 'text', 'visual', 'audio', 'other']).default('other'),
  changeScope: z.enum(['visual','dialogue','both']).optional(),
  suggestedText: z.string().trim().min(1).max(500).optional(),
}).strict();
export type FeedbackInput = z.infer<typeof feedbackInput>;
export interface Feedback extends FeedbackInput { id: string; requestId?:string; baseRevision: number; sourceFrame: number; createdAt: string; status: 'draft' | 'queued' | 'claimed' | 'review' | 'resolved'; batchId?: string; proposalId?: string; reply?: string }
export interface Batch { id: string; feedbackIds: string[]; status: 'queued' | 'claimed' | 'review' | 'done'; createdAt: string; delivery?:{state:'sending'|'queued'|'notified'|'failed';at:string;messageId?:string;needsResume?:boolean;error?:string} }
export interface AgentSession {provider:'codex';threadId:string;label:string;boundAt:string}
export interface AgentOwner {provider:'codex'|'claude'|'mcp';label:string;openedAt:string}
export interface RequestRecord {kind:string;signature:string;ids:string[]}
export interface Proposal { id: string; requestId: string; baseRevision: number; operations: Operation[]; rationale: string; feedbackIds: string[]; status: 'pending' | 'accepted' | 'rejected'; createdAt: string; appliedRevision?: number }
export interface RenderJob { id: string; revision: number; state: 'queued' | 'rendering' | 'done' | 'failed' | 'cancelled'; progress: number; createdAt: string; error?: string; file?: string }
export interface VoiceJob { id:string;captionId:string;clipId:string;text:string;start:number;end:number;voiceLabel:string;guidance:string;baseRevision:number;createdAt:string;status:'queued'|'claimed'|'review'|'accepted'|'rejected'|'failed'|'stale';proposalId?:string;error?:string }
export interface Project { stateVersion?:number; id: string; revision: number; createdAt: string; updatedAt: string; composition: Composition; assets: Asset[]; history: Revision[]; feedback: Feedback[]; batches: Batch[]; proposals: Proposal[]; renders: RenderJob[]; agent: { name: string; lastSeen: string }; agentSession?:AgentSession;agentOwner?:AgentOwner;openedFrom?:{directory:string;host:string;at:string}; receipts: Record<string, number>; requestRecords?:Record<string,RequestRecord>; voiceJobs?:VoiceJob[] }

export class DomainError extends Error { constructor(public code: string, message: string, public status = 400) { super(message); } }
export const totalFrames = (c: Composition) => c.clips.reduce((sum, clip) => sum + clip.duration, 0);
export const clipStart = (c: Composition, id: string) => { let t = 0; for (const clip of c.clips) { if (clip.id === id) return t; t += clip.duration; } return -1; };
export function locateClip(c: Composition, t: number) { let start = 0; for (const clip of c.clips) { if (t < start + clip.duration) return { clip, start }; start += clip.duration; } return { clip: c.clips[c.clips.length - 1], start: start - c.clips.at(-1)!.duration }; }
export function feedbackLocation(c: Composition, note: Feedback) {
  const clip = c.clips.find(x => x.id === note.clipId);
  if (!clip) return { stale: true, reason: '原镜头已移除', frame: 0 };
  if (note.captionId && !c.captions.some(x => x.id === note.captionId)) return { stale: true, reason: '原字幕已移除', frame: clipStart(c, clip.id) };
  const offset = clip.kind === 'video' ? note.sourceFrame - clip.sourceIn : note.offset;
  const end = note.endOffset === undefined ? offset : offset + note.endOffset - note.offset;
  if (offset < 0 || offset >= clip.duration || end >= clip.duration) return { stale: true, reason: '批注范围已被裁剪或拆分，请重新定位', frame: clipStart(c, clip.id) };
  return { stale: false, reason: '', frame: clipStart(c, clip.id) + offset };
}
export function validateComposition(input: unknown): Composition {
  const c = compositionSchema.parse(input);
  if (totalFrames(c) > 18000) throw new DomainError('TOO_LONG', '首版工程最长为 10 分钟。');
  const ids = [...c.clips.map(x => x.id), ...c.captions.map(x => x.id)];
  if (new Set(ids).size !== ids.length) throw new DomainError('DUPLICATE_ID', '镜头与字幕 ID 必须唯一。');
  for (const clip of c.clips) if (clip.kind !== 'card' && !clip.assetId) throw new DomainError('MISSING_ASSET', `镜头「${clip.name}」没有素材。`);
  for (const cap of c.captions) {
    const clip = c.clips.find(x => x.id === cap.clipId);
    if (!clip || cap.end <= cap.start || cap.end > clip.duration) throw new DomainError('CAPTION_RANGE', `字幕「${cap.text.slice(0,20)}」不在镜头范围内。`);
    if(cap.voice&&cap.voice.durationFrames>cap.end-cap.start)throw new DomainError('VOICE_TOO_LONG',`字幕「${cap.text.slice(0,20)}」的配音超过可用时段，请先调整字幕时间或移除配音，不能截断尾音。`);
  }
  const voiced=c.captions.filter(cap=>cap.voice).map(cap=>({start:clipStart(c,cap.clipId)+cap.start,end:clipStart(c,cap.clipId)+cap.start+cap.voice!.durationFrames})).sort((a,b)=>a.start-b.start);
  if(voiced.some((v,i)=>i>0&&v.start<voiced[i-1].end))throw new DomainError('VOICE_OVERLAP','两句配音的播放范围重叠，请先调整字幕时段。');
  return c;
}

const groups: Record<string, Protection> = { sourceIn: 'timing', duration: 'timing', title: 'text', subtitle: 'text', kicker: 'text', name: 'text', volume: 'audio', assetId: 'visual', layout: 'visual', background: 'visual', accent: 'visual', color: 'visual', fontSize: 'visual', x: 'visual', y: 'visual', scale: 'visual' };
export function applyOperations(input: Composition, operations: Operation[], actor: 'human' | 'agent'): Composition {
  const c = structuredClone(input);
  const guard = (clip: Clip, fields: Protection[]) => { if (actor === 'agent' && fields.some(f => clip.protected.includes(f))) throw new DomainError('PROTECTED', `镜头「${clip.name}」包含受保护的修改。`, 409); };
  for (const raw of operations) {
    const op = operationSchema.parse(raw);
    const clip = 'id' in op ? c.clips.find(x => x.id === op.id) : undefined;
    if (['update_clip','remove_clip','move_clip','split_clip','protect_clip'].includes(op.type) && !clip) throw new DomainError('NOT_FOUND', '目标镜头不存在。', 404);
    switch (op.type) {
      case 'update_clip': {
        guard(clip!, Object.keys(op.patch).filter(k => (clip as unknown as Record<string, unknown>)[k] !== (op.patch as Record<string, unknown>)[k]).map(k => groups[k]));
        const delta = (op.patch.sourceIn ?? clip!.sourceIn) - clip!.sourceIn;
        const duration = op.patch.duration ?? clip!.duration;
        if (delta || duration !== clip!.duration) c.captions = c.captions.flatMap(cap => {
          if (cap.clipId !== clip!.id) return [cap];
          const start = Math.max(0, cap.start - delta), end = Math.min(duration, cap.end - delta);
          if (end <= start) guard(clip!, ['text','visual',...(cap.voice?['audio' as const]:[])]);
          return end > start ? [{ ...cap, start, end }] : [];
        });
        Object.assign(clip!, op.patch); break;
      }
      case 'insert_clip': {
        if (op.afterId && !c.clips.some(x => x.id === op.afterId)) throw new DomainError('NOT_FOUND', '插入位置不存在。');
        if (actor === 'agent' && op.clip.protected.length) throw new DomainError('PROTECTED', '只有用户可以设置保护。');
        const index = op.afterId ? c.clips.findIndex(x => x.id === op.afterId) + 1 : c.clips.length;
        c.clips.splice(index, 0, structuredClone(op.clip)); break;
      }
      case 'remove_clip': guard(clip!, ['timing','text','visual','audio']); c.clips = c.clips.filter(x => x.id !== op.id); c.captions = c.captions.filter(x => x.clipId !== op.id); break;
      case 'move_clip': guard(clip!, ['timing']); if (op.toIndex >= c.clips.length) throw new DomainError('OUT_OF_RANGE', '目标顺序超出镜头数量。'); c.clips.splice(c.clips.indexOf(clip!),1); c.clips.splice(op.toIndex,0,clip!); break;
      case 'split_clip': {
        guard(clip!, ['timing','text','visual','audio']);
        if (op.at >= clip!.duration) throw new DomainError('OUT_OF_RANGE', '拆分位置必须在镜头内部。');
        if(c.captions.some(cap=>cap.clipId===op.id&&cap.voice&&cap.start<op.at&&cap.end>op.at))throw new DomainError('VOICE_SPLIT','不能从已配音字幕中间拆分，请在句间拆分或先移除该句配音。');
        const second = { ...structuredClone(clip!), id: op.newId, name: `${clip!.name} · 后段`, duration: clip!.duration - op.at, sourceIn: clip!.kind === 'video' ? clip!.sourceIn + op.at : clip!.sourceIn };
        clip!.duration = op.at;
        c.clips.splice(c.clips.indexOf(clip!) + 1, 0, second);
        c.captions = c.captions.flatMap(cap => cap.clipId !== op.id ? [cap] : [
          ...(cap.start < op.at ? [{...cap, end: Math.min(cap.end,op.at)}] : []),
          ...(cap.end > op.at ? [{...cap, id: `${cap.id.slice(0,30)}_${op.newId.slice(0,35)}`, clipId: op.newId, start: Math.max(0,cap.start - op.at), end: cap.end - op.at}] : []),
        ]); break;
      }
      case 'protect_clip': if (actor !== 'human') throw new DomainError('PROTECTED', '只有用户可以设置保护。'); clip!.protected = [...new Set(op.fields)]; break;
      case 'add_caption': { const owner = c.clips.find(x => x.id === op.caption.clipId); if (!owner) throw new DomainError('NOT_FOUND', '字幕所属镜头不存在。'); guard(owner,op.caption.voice?['text','audio']:['text']); c.captions.push(op.caption); break; }
      case 'set_caption_voice': {
        const cap=c.captions.find(x=>x.id===op.id);if(!cap)throw new DomainError('NOT_FOUND','配音对应字幕不存在。');
        guard(c.clips.find(x=>x.id===cap.clipId)!,['audio']);
        if(op.voice&&op.voice.text!==cap.text&&!(actor==='human'&&cap.voice?.assetId===op.voice.assetId&&cap.voice.text===op.voice.text&&cap.voice.durationFrames===op.voice.durationFrames))throw new DomainError('STALE_VOICE','配音文本与当前字幕不一致，请重新生成。',409);
        cap.voice=op.voice;break;
      }
      case 'update_caption': case 'remove_caption': {
        const cap = c.captions.find(x => x.id === op.id); if (!cap) throw new DomainError('NOT_FOUND', '字幕不存在。');
        guard(c.clips.find(x => x.id === cap.clipId)!, op.type === 'remove_caption' ? ['text','timing','visual',...(cap.voice?['audio' as const]:[])] : Object.keys(op.patch).map(k => k === 'text' ? 'text' : ['start','end'].includes(k) ? 'timing' : 'visual'));
        if (op.type === 'remove_caption') c.captions = c.captions.filter(x => x.id !== op.id); else Object.assign(cap,op.patch); break;
      }
      case 'set_music': if (actor === 'agent' && c.musicProtected) throw new DomainError('PROTECTED', '背景音乐已被保护。',409); c.music = op.music; break;
      case 'protect_music': if (actor !== 'human') throw new DomainError('PROTECTED', '只有用户可以设置保护。'); c.musicProtected = op.value; break;
    }
  }
  return validateComposition(c);
}

export function formatTime(frames: number, fps = 30) { const s = Math.floor(frames / fps); return `${Math.floor(s / 60).toString().padStart(2,'0')}:${(s % 60).toString().padStart(2,'0')}.${(frames % fps).toString().padStart(2,'0')}`; }
export function displayText(text: string) {
  return text.split(/(https?:\/\/\S+|`[^`]*`)/g).map((part, i) => i % 2 ? part : part.replace(/[\u2014\u2013]/g,'--').replace(/([\u3400-\u9fff])([A-Za-z0-9])/g,'$1 $2').replace(/([A-Za-z0-9])([\u3400-\u9fff])/g,'$1 $2').replace(/([\u3400-\u9fff])[,]/g,'$1，').replace(/([\u3400-\u9fff])[!]/g,'$1！').replace(/([\u3400-\u9fff])[?]/g,'$1？')).join('');
}
