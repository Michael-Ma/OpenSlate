import { parse } from '@babel/parser';
import { Worker } from 'node:worker_threads';
import { canonical,DomainError,invariant } from '../common.js';
import type { CompileContext,CompiledPlan } from '../contracts.js';
import { assertRestrictedPlanSource,compilePlan,PLAN_LIMITS,printRestrictedPlan } from './index.js';
import { assertPlanCompositionContext,snapshotPlanCompositionData } from './speech-composition.js';
import type { RestrictedPlanAst } from './index.js';
export interface ModelProfileReplacement { nodeId:string;profileId:string }
type Ast=RestrictedPlanAst;
const fail=(condition:unknown,message:string):void=>invariant(condition,'MODEL_PLAN_INVALID',message);
const obj=(value:unknown):Ast=>{fail(value&&typeof value==='object'&&typeof (value as Ast).type==='string','Expected validated plan syntax');return value as Ast;};
const arr=(value:unknown):Ast[]=>{fail(Array.isArray(value),'Expected validated plan list');return value as Ast[];};
const key=(value:Ast):string=>String(obj(value.key).name??obj(value.key).value);
const field=(value:Ast,name:string):Ast=>{const matches=arr(value.properties).filter(p=>key(p)===name);fail(matches.length===1,`Expected one ${name} field`);return matches[0]!;};
const put=(value:Ast,name:string,replacement:Ast):void=>{const prior=arr(value.properties).find(p=>key(p)===name);if(prior)prior.value=replacement;else arr(value.properties).push({type:'ObjectProperty',key:{type:'Identifier',name},value:replacement,computed:false,shorthand:false});};
const string=(value:string):Ast=>({type:'StringLiteral',value});
function declaration(source:string):Ast{assertRestrictedPlanSource(source);const file=obj(parse(source,{sourceType:'module',strictMode:true,errorRecovery:false,plugins:['typescript']}));const statements=arr(obj(file.program).body);fail(statements.length===1,'Expected one saved plan');return obj(statements[0]!.expression);}
const method=(node:Ast):string|null=>node.type==='CallExpression'&&obj(node.callee).type==='MemberExpression'?String(obj(obj(node.callee).property).name):null;
function revision(call:Ast):Ast{return obj(field(arr(call.arguments)[0]!,'baseRevision').value);}
function same(a:CompiledPlan,b:CompiledPlan):void{fail(a.graphDigest===b.graphDigest&&canonical(a.nodes)===canonical(b.nodes)&&canonical(a.gates)===canonical(b.gates),'Saved graph no longer matches its source and project');}
/** Called inside the isolated worker. The original source is validated before any AST printing. */
export function composeModelProfiles(base:CompiledPlan,replacements:readonly ModelProfileReplacement[],context:CompileContext):CompiledPlan{
  fail(replacements.length<=PLAN_LIMITS.nodes&&new Set(replacements.map(item=>item.nodeId)).size===replacements.length,'Duplicate or excessive model replacements');
  const original=declaration(base.source),savedRevision=revision(original).value;
  fail(typeof savedRevision==='string','Invalid saved revision');
  const verified=compilePlan(base.source,{...context,project:{...context.project,revisionId:savedRevision as string}});same(base,verified);
  fail(verified.canonicalSource===base.canonicalSource,'Saved canonical source differs');
  const ast=declaration(verified.canonicalSource);revision(ast).value=context.project.revisionId;
  same(base,compilePlan(printRestrictedPlan(ast),context));
  const symbols=new Map<string,Ast>(),calls:Ast[]=[];
  const walk=(node:Ast):void=>{
    if(node.type==='VariableDeclarator')symbols.set(String(obj(node.id).name),obj(node.init));
    if(node.type==='CallExpression')calls.push(node);
    for(const value of Object.values(node))if(Array.isArray(value)){for(const item of value)if(item&&typeof item==='object'&&typeof (item as Ast).type==='string')walk(item as Ast);}
    else if(value&&typeof value==='object'&&typeof (value as Ast).type==='string')walk(value as Ast);
  };walk(ast);
  const resolve=(expression:Ast,depth=0):Ast=>{fail(expression&&depth<=128,'Reference exceeds syntax bound');return expression.type==='Identifier'?resolve(symbols.get(String(expression.name))!,depth+1):expression;};
  const reference=(expression:Ast):string=>{const call=resolve(expression),name=method(call),args=arr(call.arguments);if(name==='asset')return `artifact:${obj(args[0]).value}`;
    const node=base.nodes.find(item=>item.alias===obj(args[0]).value);fail(node,'Unknown saved reference');return `output:${node!.id}`;};
  const shot=(expression:Ast):string=>{const call=resolve(expression);fail(method(call)==='shot','Expected saved shot');const id=String(obj(arr(call.arguments)[0]).value),found=context.project.shots.find(s=>s.id===id||s.revisionId===id||`${s.id}@${s.revisionId}`===id);fail(found,'Unknown saved shot');return found!.id;};
  for(const change of replacements){
    const node=base.nodes.find(item=>item.id===change.nodeId),profile=context.profiles.find(item=>item.id===change.profileId);
    fail(node&&profile&&profile.kind===node.kind&&['image','video','speech','transcription'].includes(node.kind),'Invalid model replacement');
    const matches=calls.filter(call=>method(call)===node!.kind&&obj(arr(call.arguments)[0]).value===node!.alias);fail(matches.length===1,'Operation call is missing or duplicated');
    const options=obj(arr(matches[0]!.arguments)[1]);put(options,'profile',string(change.profileId));put(options,'settings',{type:'ObjectExpression',properties:[]});
    if(node!.kind==='image')for(const dimension of ['width','height']){const value=profile!.configuration?.settings?.[dimension];if(typeof value==='number')put(options,dimension,{type:'NumericLiteral',value});}
    if(node!.kind==='video'){
      const gate=base.gates.find(g=>g.id===node!.requires[0]);fail(gate,'Video lost its review gate');
      const review=calls.find(call=>method(call)==='humanReview'&&obj(arr(call.arguments)[0]).value===gate!.alias);fail(review,'Review syntax is missing');
      const members=arr(obj(field(obj(arr(review!.arguments)[1]),'shots').value).elements),input=node!.inputs[0]!.source;
      const source=input.kind==='artifact'?`artifact:${input.artifact.artifactId}`:`output:${input.nodeId}`;
      const membersForNode=members.filter(member=>shot(obj(field(member,'intent').value))===node!.shotId&&reference(obj(field(member,'keyframe').value))===source);
      fail(membersForNode.length===1,'Review member is ambiguous');put(membersForNode[0]!,'videoProfile',string(change.profileId));put(membersForNode[0]!,'settings',{type:'ObjectExpression',properties:[]});
    }
  }
  const compiled=compilePlan(printRestrictedPlan(ast),context),changed=new Set(replacements.map(item=>item.nodeId));
  const affected=new Set(changed);
  for(let pass=0;pass<base.nodes.length;pass++)for(const node of base.nodes)if(node.inputs.some(input=>input.source.kind==='output'&&affected.has(input.source.nodeId)))affected.add(node.id);
  fail(compiled.nodes.length===base.nodes.length&&compiled.nodes.every((node,index)=>{
    const old=base.nodes[index]!;return node.id===old.id&&(changed.has(node.id)||canonical(affected.has(node.id)?{...node,specDigest:old.specDigest}:node)===canonical(old));
  }),'Model change modified an unrelated operation');
  for(const gate of base.gates){const next=compiled.gates.find(item=>item.id===gate.id);fail(next&&gate.alias===next.alias&&gate.members.length===next.members.length,'Model change modified gate identity');
    gate.members.forEach((member,index)=>{const updated=next!.members[index]!;fail(canonical({...updated,recipeDigest:member.recipeDigest})===canonical(member)
      &&(affected.has(member.videoNodeId)||updated.recipeDigest===member.recipeDigest),'Model change modified unrelated review evidence');});}
  return compiled;
}
export async function composeModelProfilesIsolated(base:CompiledPlan,replacements:readonly ModelProfileReplacement[],context:CompileContext,options:{signal?:AbortSignal}={}):Promise<CompiledPlan>{
  const signal=options.signal;invariant(!signal?.aborted,'MODEL_SETTINGS_CANCELLED','Model preview was cancelled');
  assertPlanCompositionContext(context);
  const original=context.logicalIds,ids=snapshotPlanCompositionData(original),data=snapshotPlanCompositionData({base,replacements,context:{project:context.project,profiles:context.profiles,logicalIds:ids,
    ...(context.localExecution?{localExecution:context.localExecution}:{}),...(context.transcriptionInputs?{transcriptionInputs:context.transcriptionInputs}:{})}});
  assertRestrictedPlanSource(data.base.source);
  return new Promise((resolve,reject)=>{const worker=new Worker(new URL('./worker.js',import.meta.url),{workerData:{mode:'compose_models',...data},resourceLimits:{maxOldGenerationSizeMb:64,stackSizeMb:4}});let settled=false;
    const finish=async(error?:unknown,plan?:CompiledPlan,resultIds?:Record<string,string>)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);await worker.terminate();
      try{invariant(!signal?.aborted,'MODEL_SETTINGS_CANCELLED','Model preview was cancelled');if(error)throw error;const current=Object.getOwnPropertyDescriptor(context,'logicalIds');fail(plan&&canonical(resultIds)===canonical(ids)&&current&&Object.hasOwn(current,'value')&&current.value===original&&canonical(snapshotPlanCompositionData(original))===canonical(ids),'Model change replaced logical identities');resolve(plan!);}catch(e){reject(e);}};
    const abort=()=>{void finish(new DomainError('MODEL_SETTINGS_CANCELLED','Model preview was cancelled'));};const timer=setTimeout(()=>void finish(new DomainError('PLAN_LIMIT','Model preview exceeded its deadline')),PLAN_LIMITS.timeoutMs);
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();worker.on('error',error=>void finish(error));worker.on('exit',code=>{if(!settled)void finish(new DomainError('COMPILER_FAILED',`Model worker exited ${code}`));});
    worker.on('message',(message:{ok:boolean;plan?:CompiledPlan;logicalIds?:Record<string,string>;error?:{code:string;message:string}})=>void finish(message.ok?undefined:new DomainError(message.error?.code??'COMPILER_FAILED',message.error?.message??'Model composition failed'),message.plan,message.logicalIds));
  });
}
