import { parse } from '@babel/parser';
import { Worker } from 'node:worker_threads';
import { canonical, DomainError, invariant } from '../common.js';
import type { CompileContext, CompiledPlan, InputSource, ProjectRecord } from '../contracts.js';
import { assertRestrictedPlanSource, compilePlan, PLAN_LIMITS, printRestrictedPlan } from './index.js';
import type { RestrictedPlanAst } from './index.js';
import { assertPlanCompositionContext, snapshotPlanCompositionData } from './speech-composition.js';

export interface NarrationPlanRebaseOptions { allowedNarrationSourceKeys: string[]; signal?: AbortSignal }
type Ast = RestrictedPlanAst;
const fail = (ok: unknown, message: string): void => invariant(ok, 'NARRATION_PLAN_REBASE_UNSUPPORTED', message);
const ast = (value: unknown): Ast => { fail(value && typeof value === 'object' && typeof (value as Ast).type === 'string', 'Expected validated plan syntax'); return value as Ast; };
const list = (value: unknown): Ast[] => { fail(Array.isArray(value), 'Expected validated plan syntax list'); return value as Ast[]; };
const key = (property: Ast) => String(ast(property.key).name ?? ast(property.key).value);
function field(value: Ast, name: string): Ast { const found = list(value.properties).filter(p => key(p) === name); fail(found.length === 1, `Expected one ${name} property`); return found[0]!; }
function declaration(source: string): Ast {
  assertRestrictedPlanSource(source);
  const parsed = ast(parse(source, { sourceType: 'module', strictMode: true, errorRecovery: false, plugins: ['typescript'] }));
  const statements = list(ast(parsed.program).body); fail(statements.length === 1 && statements[0]!.type === 'ExpressionStatement', 'Expected one restricted saved plan');
  const value = ast(statements[0]!.expression); fail(value.type === 'CallExpression' && ast(value.callee).name === 'definePlan', 'Expected a saved definePlan'); return value;
}
/** Canonical printer header only. This bounded token read performs no source execution or broad regular-expression search. */
export function planSourceBaseRevision(plan: CompiledPlan): string {
  assertRestrictedPlanSource(plan.canonicalSource);
  const header = /^definePlan\(\{\s*"baseRevision"\s*:\s*("(?:[^"\\]|\\.)*")\s*\},/.exec(plan.canonicalSource);
  fail(header, 'The saved plan has an unsupported canonical header; review its plan before adding narration');
  const revision: unknown = JSON.parse(header![1]!); fail(typeof revision === 'string' && revision.length > 0 && revision.length <= 160, 'The saved plan has an invalid base revision'); return revision as string;
}
export function narrationInputSourceKey(source: InputSource): string { return source.kind === 'artifact' ? `artifact:${source.artifact.artifactId}` : `output:${source.nodeId}:${source.port}`; }
function samePlan(old: CompiledPlan, verified: CompiledPlan) { fail(old.graphDigest === verified.graphDigest && canonical(old.nodes) === canonical(verified.nodes) && canonical(old.gates) === canonical(verified.gates) && old.canonicalSource === verified.canonicalSource, 'The saved graph no longer matches its original source and project revision'); }
/** Worker-only deterministic AST transformation. Every paid operation and review gate must remain exact. */
export function rebaseNarrationPlan(base: CompiledPlan, originalProject: ProjectRecord, context: CompileContext, allowedNarrationSourceKeys: string[]): CompiledPlan {
  fail(originalProject.id === context.project.id && originalProject.revisionId === planSourceBaseRevision(base), 'The original plan project revision is unavailable');
  fail(originalProject.capabilityLockId === context.project.capabilityLockId, 'Model settings changed; review the current plan before adding narration');
  for (const item of [...base.nodes, ...base.gates]) { fail(!context.logicalIds[item.alias] || context.logicalIds[item.alias] === item.id, 'The saved plan aliases changed'); context.logicalIds[item.alias] = item.id; }
  const verified = compilePlan(base.source, { ...context, project: originalProject }); samePlan(base, verified);
  const syntax = declaration(verified.canonicalSource), args = list(syntax.arguments), header = args[0]!, arrow = args[1]!;
  ast(field(header, 'baseRevision').value).value = context.project.revisionId;
  const receiver = String(ast(list(arrow.params)[0]).name), allowed = new Set(allowedNarrationSourceKeys);
  const method = (node: Ast) => node.type === 'CallExpression' && ast(node.callee).type === 'MemberExpression' && ast(ast(node.callee).object).name === receiver ? String(ast(ast(node.callee).property).name) : null;
  const walk = (node: Ast): void => {
    const name = method(node), arguments_ = name ? list(node.arguments) : [];
    if (name === 'shot') {
      const literal = ast(arguments_[0]); fail(literal.type === 'StringLiteral', 'A shot reference is not a literal');
      const old = originalProject.shots.find(shot => [shot.id, shot.revisionId, `${shot.id}@${shot.revisionId}`].includes(String(literal.value)));
      fail(old && context.project.shots.some(shot => shot.id === old.id), 'A referenced shot changed or was deleted'); literal.value = old!.id;
    }
    if (name === 'timeline') {
      const alias = ast(arguments_[0]), options = ast(arguments_[1]); fail(alias.type === 'StringLiteral' && options.type === 'ObjectExpression', 'Timeline choices have an unsupported form');
      const saved = base.nodes.find(node => node.kind === 'timeline' && node.alias === alias.value); fail(saved, 'The saved timeline alias is unavailable');
      const narration = saved!.inputs.find(input => input.destinationPort === 'narration');
      if (narration) {
        fail(allowed.has(narrationInputSourceKey(narration.source)), 'An explicit timeline audio input is not committed narration; select it as background music or review this plan');
        options.properties = list(options.properties).filter(property => key(property) !== 'narration');
      }
      const range = list(options.properties).find(property => key(property) === 'cueRange');
      if (range) {
        const value = ast(range.value); fail(value.type === 'StringLiteral', 'Timeline cue range is not a literal');
        if (originalProject.cues.some(cue => cue.id === value.value)) {
          const oldShots = originalProject.shots.filter(shot => shot.cueId === value.value);
          const current = [...new Set(oldShots.map(old => context.project.shots.find(shot => shot.id === old.id)?.cueId).filter(id => id !== null && id !== undefined))];
          fail(oldShots.length > 0 && current.length === 1, 'An explicit cue range cannot be mapped uniquely to the accepted narration'); value.value = current[0];
        } else {
          const old = originalProject.scenes.find(scene => [scene.id, scene.revisionId, `${scene.id}@${scene.revisionId}`].includes(String(value.value)));
          fail(old && context.project.scenes.some(scene => scene.id === old.id), 'The explicit scene range changed'); value.value = old!.id;
        }
      }
    }
    for (const value of Object.values(node)) if (Array.isArray(value)) { for (const child of value) if (child && typeof child === 'object' && typeof (child as Ast).type === 'string') walk(child as Ast); }
    else if (value && typeof value === 'object' && typeof (value as Ast).type === 'string') walk(value as Ast);
  }; walk(syntax);
  const next = compilePlan(printRestrictedPlan(syntax), context); fail(next.nodes.length === base.nodes.length && canonical(next.gates) === canonical(base.gates), 'Narration cannot add operations or change frame review');
  for (const [index, node] of next.nodes.entries()) {
    const old = base.nodes[index]!; fail(node.id === old.id && node.alias === old.alias && node.kind === old.kind, 'Narration changed the operation topology');
    if (node.kind === 'timeline') {
      const { cues: _oldCues, ...oldArgs } = old.args, { cues: _newCues, ...newArgs } = node.args;
      fail(canonical(oldArgs) === canonical(newArgs) && canonical(old.inputs.filter(input => input.destinationPort !== 'narration')) === canonical(node.inputs)
        && node.intentDigest === old.intentDigest && canonical(node.requires) === canonical(old.requires), 'Narration changed timeline take order, transition or geometry');
    } else if (node.kind === 'render') fail(canonical({ ...node, specDigest: old.specDigest }) === canonical(old), 'Narration changed the export geometry or format');
    else {
      fail(canonical({ ...node, shotRevisionId: null }) === canonical({ ...old, shotRevisionId: null }), 'A visual or speech operation changed; update that work explicitly before adding narration');
    }
  }
  return next;
}
export async function rebaseNarrationPlanIsolated(base: CompiledPlan, originalProject: ProjectRecord, context: CompileContext, options: NarrationPlanRebaseOptions): Promise<CompiledPlan> {
  assertPlanCompositionContext(context); const signal = options.signal;
  invariant(!signal?.aborted, 'PLAN_COMPOSITION_CANCELLED', 'Narration plan rebase was cancelled');
  const ids = snapshotPlanCompositionData(context.logicalIds), captured = snapshotPlanCompositionData({ base, originalProject, allowedNarrationSourceKeys: options.allowedNarrationSourceKeys, context: {
    project: context.project, profiles: context.profiles, logicalIds: ids, ...(context.localExecution ? { localExecution: context.localExecution } : {}), ...(context.transcriptionInputs ? { transcriptionInputs: context.transcriptionInputs } : {}),
  } });
  fail(captured.allowedNarrationSourceKeys.length <= PLAN_LIMITS.nodes * 2 && captured.allowedNarrationSourceKeys.every(key => typeof key === 'string' && key.length <= 400), 'Narration source selection exceeds its bounds');
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.js', import.meta.url), { workerData: { mode: 'rebase_narration', ...captured }, resourceLimits: { maxOldGenerationSizeMb: 64, stackSizeMb: 4 } }); let settled = false;
    const finish = async (error?: unknown, plan?: CompiledPlan, resultIds?: Record<string, string>) => {
      if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); await worker.terminate();
      try { invariant(!signal?.aborted, 'PLAN_COMPOSITION_CANCELLED', 'Narration plan rebase was cancelled'); if (error) throw error; fail(plan && canonical(resultIds) === canonical(ids) && canonical(context.logicalIds) === canonical(ids), 'Narration changed logical operation identities'); resolve(plan!); } catch (cause) { reject(cause); }
    };
    const abort = () => { void finish(new DomainError('PLAN_COMPOSITION_CANCELLED', 'Narration plan rebase was cancelled')); };
    const timer = setTimeout(() => void finish(new DomainError('PLAN_LIMIT', 'Narration plan rebase exceeded its deadline')), PLAN_LIMITS.timeoutMs);
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    worker.on('error', error => void finish(error)); worker.on('exit', code => { if (!settled) void finish(new DomainError('COMPILER_FAILED', `Narration worker exited ${code}`)); });
    worker.on('message', (message: { ok: boolean; plan?: CompiledPlan; logicalIds?: Record<string, string>; error?: { code: string; message: string } }) => void finish(message.ok ? undefined : new DomainError(message.error?.code ?? 'COMPILER_FAILED', message.error?.message ?? 'Narration plan rebase failed'), message.plan, message.logicalIds));
  });
}
