const path=require('node:path'),fs=require('node:fs'),http=require('node:http'),assert=require('node:assert/strict');
const {rollup}=require('rollup'),{nodeResolve}=require('@rollup/plugin-node-resolve'),commonjs=require('@rollup/plugin-commonjs');
const puppeteer=require(process.env.PUPPETEER_MODULE||'puppeteer');
(async()=>{
 const entry=path.resolve('.browser-lifecycle.js');
 fs.writeFileSync(entry,`import React from 'react';import{createRoot}from'react-dom/client';import{useChatInstance}from'./dist/index.esm.js';function App(){const[user,setUser]=React.useState(()=>{const who=localStorage.getItem('host-account')||localStorage.getItem('test-account');return who?{id:who,token:who,email:who+'@example.test'}:undefined});const session=useChatInstance({chatModelId:'model',lang:'en',config:{apiUrl:location.origin},user});window.session=session;window.login=who=>{localStorage.setItem('test-account',who);setUser({id:who,token:who,email:who+'@example.test'})};window.logout=()=>{session.beginAnonymousSession();localStorage.removeItem('test-account');setUser(undefined)};return React.createElement('p',null,session.chatInstanceId+'|'+(session.error?.code||''))}createRoot(document.getElementById('root')).render(React.createElement(App));`);
 const bundle=await rollup({input:entry,plugins:[nodeResolve({browser:true,preferBuiltins:false,dedupe:['react','react-dom']}),commonjs()],onwarn(){}});
 const code=(await bundle.generate({format:'iife'})).output[0].code;await bundle.close();fs.unlinkSync(entry);
 const threads=new Map();let requests=0,created=0;
 const server=http.createServer(async(req,res)=>{
  if(req.url==='/bundle.js'){res.setHeader('Content-Type','application/javascript');return res.end(code)}
  if(req.url==='/api/chat/createInstance'){
   requests++;let raw='';for await(const chunk of req)raw+=chunk;const b=JSON.parse(raw);const account=req.headers.authorization?.slice(7);let status=200,data;
   if(b.chatInstanceId){const row=threads.get(b.chatInstanceId);if(!row){status=404;data={code:'NOT_FOUND'}}else if(account==='expired'){status=401;data={code:'AUTH_REQUIRED'}}else if(row.owner&&row.owner!==account){status=account?403:401;data={code:account?'CONVERSATION_ACCESS_DENIED':'AUTH_REQUIRED'}}else if(!row.owner&&req.headers['x-chat-visitor-token']!==row.secret){status=403;data={code:'CONVERSATION_ACCESS_DENIED'}}else{if(account&&b.claimAnonymous)row.owner=account;data={chatInstanceId:b.chatInstanceId}}}
   else{const id='thread-'+ ++created;const secret='secret-'+id;threads.set(id,{owner:account,secret,messages:[]});data={chatInstanceId:id,...(!account?{visitorToken:secret}:{})}}
   res.statusCode=status;res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(data));
  }
  res.end('<div id="root"></div><script>window.process={env:{NODE_ENV:"production"}}</script><script src="/bundle.js"></script>');
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;const browser=await puppeteer.launch({headless:true});
 const wait=async(p,fn,...args)=>p.waitForFunction(fn,{polling:50,timeout:5000},...args);
 try{
  const p=await browser.newPage();await p.goto(url);await wait(p,()=>window.session?.chatInstanceId);const first=await p.evaluate(()=>window.session.chatInstanceId);threads.get(first).messages.push('old anonymous');
  await p.evaluate(()=>window.login('alice'));await wait(p,()=>window.session?.chatInstanceId);assert.equal(await p.evaluate(()=>window.session.chatInstanceId),first);assert.equal(threads.get(first).owner,'alice');
  await p.evaluate(()=>window.logout());await wait(p,id=>window.session?.chatInstanceId&&window.session.chatInstanceId!==id,first);const fresh=await p.evaluate(()=>window.session.chatInstanceId);assert.deepEqual(threads.get(fresh).messages,[]);assert.equal(threads.get(fresh).owner,undefined);
  threads.get(fresh).messages.push('continue anonymous after auto-login');
  await p.evaluate(()=>localStorage.setItem('host-account','alice'));await p.reload();await wait(p,()=>window.session?.chatInstanceId);assert.equal(await p.evaluate(()=>window.session.chatInstanceId),fresh);assert.equal(threads.get(fresh).owner,'alice');assert.deepEqual(threads.get(fresh).messages,['continue anonymous after auto-login']);
  await p.evaluate(()=>{localStorage.removeItem('host-account');window.login('expired')});await wait(p,()=>window.session?.error?.code==='AUTH_REQUIRED');assert.equal(await p.evaluate(()=>window.session.chatInstanceId),'');const count=created;
  await p.evaluate(()=>window.login('bob'));await wait(p,()=>window.session?.error?.code==='CONVERSATION_ACCESS_DENIED');assert.equal(created,count);
  await p.evaluate(()=>window.login('alice'));await wait(p,()=>window.session?.chatInstanceId);assert.equal(await p.evaluate(()=>window.session.chatInstanceId),fresh);assert.equal(created,count);
  const q=await browser.newPage();await q.goto(url);await wait(q,id=>window.session?.chatInstanceId===id,fresh);
  const idle=requests;await new Promise(r=>setTimeout(r,1200));assert.equal(requests,idle);
  await p.reload();await wait(p,id=>window.session?.chatInstanceId===id,fresh);assert.equal(created,count);
  console.log(JSON.stringify({pass:true,scenarios:['fresh logout','guest claim on login','host auto-login preserves guest conversation','expired session locks selection','different account denied','same account resumes','two tabs share selection','idle makes no requests','reload preserves exact ID'],created,requests}));
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
