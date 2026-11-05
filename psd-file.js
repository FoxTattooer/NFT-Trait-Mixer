/* Range-backed PSD/PSB reader. Pixel payloads stay in File until rasterization.
   Metadata is decoded by the pinned ag-psd parser using a payload-free skeleton. */
(function(root){
  'use strict';
  const wideKeys=new Set(['LMsk','Lr16','Lr32','Layr','Mt16','Mt32','Mtrn','Alph','FMsk','lnk2','FEid','FXid','PxSD','cinf','lnk3','lnkE','pths','extd','extn','FELS','artd']);
  const sig=bytes=>String.fromCharCode(...bytes);
  const length=(n,wide=false)=>{const b=new Uint8Array(wide?8:4),v=new DataView(b.buffer);if(wide)v.setUint32(0,Math.floor(n/4294967296));v.setUint32(wide?4:0,n%4294967296);return b;};
  const concat=parts=>{const result=new Uint8Array(parts.reduce((n,b)=>n+b.length,0));let offset=0;for(const b of parts){result.set(b,offset);offset+=b.length;}return result;};
  async function parse(file,ag,core,progress=()=>{}) {
    const read=async(offset,size)=>{
      if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(size)||offset<0||size<0||offset+size>file.size)throw new Error('PSD je neúplné nebo obsahuje neplatný rozsah dat.');
      const bytes=new Uint8Array(await file.slice(offset,offset+size).arrayBuffer());
      if(bytes.length!==size)throw new Error('Soubor se nepodařilo celý přečíst.');
      return bytes;
    };
    const number=async(offset,wide=false)=>{const b=await read(offset,wide?8:4),v=new DataView(b.buffer);const n=wide?v.getUint32(0)*4294967296+v.getUint32(4):v.getUint32(0);if(!Number.isSafeInteger(n))throw new Error('Neplatná délka sekce PSD.');return n;};
    const headerBytes=await read(0,26),header=core.validateHeader(headerBytes.buffer),large=new DataView(headerBytes.buffer).getUint16(4)===2,word=large?8:4;
    let offset=26;
    offset+=4+await number(offset);offset+=4+await number(offset); // color data and resources
    const sectionSize=await number(offset,large),sectionStart=offset+word,sectionEnd=sectionStart+sectionSize;
    if(sectionEnd>file.size)throw new Error('Sekce vrstev přesahuje konec souboru.');
    let infoSize=await number(sectionStart,large),infoStart=sectionStart+word;
    if(infoStart+infoSize>sectionEnd)throw new Error('Neplatná délka vrstev.');
    // 16/32-bit files may store their layer records in global additional info.
    let global=infoStart+infoSize+(infoSize%2);
    if(global+4<=sectionEnd)global+=4+await number(global);
    while(global+12<=sectionEnd){
      let tag=await read(global,12);
      if(tag[0]===0){global++;continue;}
      const signature=sig(tag.subarray(0,4)),key=sig(tag.subarray(4,8));
      if(signature!=='8BIM'&&signature!=='8B64')break;
      const wide=signature==='8B64'||(large&&wideKeys.has(key));
      const size=await number(global+8,wide),start=global+8+(wide?8:4);
      if(start+size>sectionEnd)throw new Error('Poškozená doplňková sekce PSD.');
      if((header.bits===16&&key==='Lr16')||(header.bits===32&&key==='Lr32')||(!infoSize&&key==='Layr')){infoStart=start;infoSize=size;break;}
      global=start+size+(size%2);
    }
    if(infoSize<2)throw new Error('PSD nemá samostatné vrstvy.');
    const countBytes=await read(infoStart,2),count=Math.abs(new DataView(countBytes.buffer).getInt16(0));
    if(!count||count>core.LIMITS.nodes)throw new Error('PSD neobsahuje podporovaný počet vrstev.');
    const records=[],ranges=[];offset=infoStart+2;let metadataBytes=0;
    for(let i=0;i<count;i++){
      const base=await read(offset,18),channels=new DataView(base.buffer).getUint16(16);
      if(channels>64)throw new Error('Vrstva obsahuje příliš mnoho kanálů.');
      const rest=await read(offset+18,channels*(2+word)+16),view=new DataView(rest.buffer),layerRanges=[];
      for(let c=0;c<channels;c++){
        const pos=c*(2+word),id=view.getInt16(pos),size=large?view.getUint32(pos+2)*4294967296+view.getUint32(pos+6):view.getUint32(pos+2);
        if(!Number.isSafeInteger(size))throw new Error('Neplatná velikost kanálu.');
        layerRanges.push({id,size});rest.fill(0,pos+2,pos+2+word);
      }
      const extraSize=view.getUint32(channels*(2+word)+12),extraStart=offset+18+rest.length;
      if(extraStart+extraSize>infoStart+infoSize)throw new Error('Poškozený záznam vrstvy.');
      // These are metadata limits, not a file-size limit. Never allocate embedded GB payloads.
      if(extraSize>4*1024*1024||(metadataBytes+=extraSize)>32*1024*1024)throw new Error('Metadata PSD jsou příliš složitá pro bezpečné načtení v telefonu.');
      const extra=await read(extraStart,extraSize);
      // Inject a record index to attach original file ranges after ag-psd builds the tree.
      const idTag=concat([new TextEncoder().encode('8BIMlyid'),length(4),length(i+1)]);
      view.setUint32(channels*(2+word)+12,extraSize+idTag.length);
      records.push(concat([base,rest,extra,idTag]));ranges.push(layerRanges);
      offset=extraStart+extraSize;progress(i+1,count);
    }
    for(const channels of ranges)for(const c of channels){c.offset=offset;offset+=c.size;if(offset>infoStart+infoSize)throw new Error('Neúplná obrazová data vrstvy.');}
    let layerInfo=concat([countBytes,...records]);if(layerInfo.length%2)layerInfo=concat([layerInfo,new Uint8Array(1)]);
    const layerSection=concat([length(layerInfo.length,large),layerInfo,length(0)]);
    const skeleton=concat([headerBytes,length(0),length(0),length(layerSection.length,large),layerSection,new Uint8Array(2)]);
    const psd=ag.readPsd(skeleton.buffer,{useRawData:true,skipCompositeImageData:true,skipThumbnail:true,skipLinkedFilesData:true,imageResourcesWhitelist:[],totalMemoryLimit:64*1024*1024});
    const byLayer=new WeakMap();
    function attach(nodes){for(const layer of nodes||[]){const channels=ranges[layer.id-1];if(!channels)throw new Error('Nesoulad struktury vrstev PSD.');byLayer.set(layer,channels);layer.rawData={colorMode:header.color,bitsPerChannel:header.bits,large,channels:channels.map(c=>({id:c.id,compression:0,data:c.size>2?new Uint8Array(1):undefined}))};attach(layer.children);}}
    attach(psd.children);
    const session=core.describe(psd,header);
    session.loadLayer=async(layer,masksOnly)=>{
      const channels=byLayer.get(layer)||[];
      const selected=channels.filter(c=>masksOnly?c.id===-2||c.id===-3:c.id>=-1);
      if(selected.reduce((n,c)=>n+c.size,0)>96*1024*1024)throw new Error('Obrazová data jedné vrstvy přesahují bezpečnou pracovní paměť.');
      const loaded=[];
      for(const c of selected){if(c.size<2){loaded.push({id:c.id,compression:0});continue;}const b=await read(c.offset,c.size),compression=new DataView(b.buffer).getUint16(0);if(compression>3)throw new Error('Vrstva obsahuje neplatnou kompresi.');loaded.push({id:c.id,compression,data:b.subarray(2)});}
      layer.rawData={colorMode:header.color,bitsPerChannel:header.bits,large,channels:loaded};
    };
    session.releaseLayer=layer=>{layer.rawData={colorMode:header.color,bitsPerChannel:header.bits,large,channels:[]};};
    return session;
  }
  const api={parse};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.TraitPSDFile=api;
})(globalThis);
