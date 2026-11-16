// Vite loads the same TypeScript/aliases as the app. JSDOM supplies the actual HTML gate's DOM.
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
const dom=new JSDOM('<!doctype html><html><body></body></html>');
Object.assign(globalThis,{window:dom.window,document:dom.window.document,DOMParser:dom.window.DOMParser,Node:dom.window.Node});
let server;
try {
 server=await createServer({mode:'editorial-eval',server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
 const {main}=await server.ssrLoadModule('/scripts/editorial-eval/rescore.ts');
 await main(process.argv.slice(2));
} catch(error) {
 const code=error instanceof Error && /^[a-z_]+$/.test(error.message)?error.message:'rescore_failed';
 console.error(JSON.stringify({status:'error',code}));process.exitCode=1;
} finally {await server?.close();dom.window.close();}