/**
 * A separate supervisor owns the command group and observes the daemon's control pipe.
 * Parent EOF initiates cleanup even after SIGKILL; the supervisor survives group escalation.
 * Descendants deliberately leaving the group require a stronger OS backend.
 */
export const WATCHDOG_SOURCE = String.raw`
import {spawn,execFile} from 'node:child_process';
import {Socket} from 'node:net';
import {rmSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
const control=new Socket({fd:3,readable:true,writable:false});
const status=new Socket({fd:4,readable:false,writable:true});
const output=new Socket({fd:1,readable:false,writable:true});
const errors=new Socket({fd:2,readable:false,writable:true});
let child;
let configuration;
let pending='';
let closeTask;
let exited=false;
let pipesClosed=Promise.resolve();
const report=(value)=>{if(!status.destroyed)status.write(JSON.stringify(value)+'\n');};
const kill=(signal)=>{
  if(!child?.pid)return;
  try {process.kill(-child.pid,signal);}
  catch(error){if(error.code!=='ESRCH')throw error;}
};
const alive=()=>new Promise((accept,reject)=>{
  if(!child?.pid){accept(false);return;}
  execFile('/bin/ps',['-A','-o','pgid=,stat='],{timeout:1000,maxBuffer:2000000},(error,stdout)=>{
    if(error){reject(error);return;}
    accept(stdout.split('\n').some(line=>{
      const[id,state]=line.trim().split(/\s+/);
      return Number(id)===child.pid&&state!==undefined&&!state.startsWith('Z');
    }));
  });
});
const waitPipes=async()=>{
  let timer;
  try{await Promise.race([pipesClosed,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Pipe closure deadline')),configuration.pipeCloseMs);})]);}
  finally{clearTimeout(timer);}
};
const finish=()=>{
  process.stdin.unpipe();
  process.stdin.destroy();
  control.destroy();
  if(configuration?.temporaryDirectory)rmSync(configuration.temporaryDirectory,{recursive:true,force:true});
  status.end();
};
const stop=()=>{
  if(closeTask)return;
  closeTask=(async()=>{
    if(child){
      try{
        kill('SIGTERM');
        const graceful=performance.now()+configuration.terminateGraceMs;
        while(await alive()){if(performance.now()>=graceful)break;await delay(20);}
        if(await alive())kill('SIGKILL');
        const deadline=performance.now()+configuration.killWaitMs;
        while(await alive()){if(performance.now()>=deadline)throw new Error('Group cleanup deadline');await delay(20);}
      }catch{kill('SIGKILL');report({type:'fault',code:'PROCESS_CLEANUP_FAILED'});}
      try{await waitPipes();}
      catch{
        child.stdin.destroy();child.stdout.destroy();child.stderr.destroy();
        report({type:'fault',code:'PROCESS_CLEANUP_FAILED'});
      }
    }
    finish();
  })();
  closeTask.catch(()=>{
    try{kill('SIGKILL');}finally{report({type:'fault',code:'PROCESS_CLEANUP_FAILED'});finish();}
  });
};
status.on('error',stop);
output.on('error',stop);
errors.on('error',stop);
process.on('SIGTERM',stop);
process.on('SIGINT',stop);
control.on('end',stop);
control.on('error',stop);
control.on('data',(bytes)=>{
  if(configuration||closeTask)return;
  pending+=bytes.toString('utf8');
  const end=pending.indexOf('\n');
  if(end<0)return;
  try{
    configuration=JSON.parse(pending.slice(0,end));
    child=spawn(configuration.command,configuration.args,{
      cwd:configuration.cwd,env:configuration.env,shell:false,
      detached:true,stdio:['pipe','pipe','pipe']
    });
    pipesClosed=new Promise(accept=>child.once('close',accept));
    process.stdin.pipe(child.stdin);
    child.stdout.pipe(output);
    child.stderr.pipe(errors);
    child.stdin.on('error',()=>{if(!exited){report({type:'fault',code:'PROCESS_PIPE_FAILED'});stop();}});
    child.stdout.on('error',()=>{report({type:'fault',code:'PROCESS_PIPE_FAILED'});stop();});
    child.stderr.on('error',()=>{report({type:'fault',code:'PROCESS_PIPE_FAILED'});stop();});
    child.once('spawn',()=>report({type:'started',pid:child.pid}));
    child.once('error',()=>{report({type:'fault',code:'PROCESS_START_FAILED'});stop();});
    child.once('exit',(code,signal)=>{exited=true;report({type:'exit',code,signal});stop();});
  }catch{report({type:'fault',code:'PROCESS_START_FAILED'});stop();}
});
`;
