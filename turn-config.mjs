import fs from 'node:fs';
import path from 'node:path';
export function createTurnConfig(dataDir) {
  let cached = null;
  let cachedAt = 0;
  return async function loadTurnServers() {
    const directFile = path.join(dataDir,'turn.json');
    const meteredFile = path.join(dataDir,'metered.json');
    let servers=[];
    if(fs.existsSync(directFile)){
      const config=JSON.parse(fs.readFileSync(directFile,'utf8'));
      servers=Array.isArray(config)?config:config.iceServers;
    }else if(process.env.STATZ_ICE_SERVERS){
      servers=JSON.parse(process.env.STATZ_ICE_SERVERS);
    }else if(fs.existsSync(meteredFile)){
      const config=JSON.parse(fs.readFileSync(meteredFile,'utf8'));
      const app=String(config.app_name||'').replace(/\.metered\.live$/,'');
      if(!/^[a-z0-9-]+$/.test(app)||!config.api_key)throw Error('Configuração Metered inválida.');
      if(cached && Date.now()-cachedAt<300000)return cached;
      const url=new URL(`https://${app}.metered.live/api/v1/turn/credentials`);
      url.searchParams.set('apiKey',config.api_key);
      const response=await fetch(url,{signal:AbortSignal.timeout(8000)});
      if(!response.ok)throw Error('O provedor TURN recusou a solicitação.');
      servers=await response.json();
      cachedAt=Date.now();
    }
    if(!Array.isArray(servers))throw Error('Lista TURN inválida.');
    for(const server of servers){
      const urls=Array.isArray(server.urls)?server.urls:[server.urls];
      if(!urls.length||urls.some(url=>typeof url!=='string'||!/^stuns?:|^turns?:/.test(url)))throw Error('Endereço ICE inválido.');
    }
    cached=servers;
    return servers;
  };
}
