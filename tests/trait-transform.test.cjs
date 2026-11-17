'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const Transform = require('../trait-transform');

const bounds = { x:0, y:0, width:1, height:1 };
const pose = () => ({ ...bounds, skewX:0, skewY:0, distort:Array.from({length:4},() => [0,0]), warp:Array.from({length:16},() => [0,0]) });
const near = (actual,expected) => actual.forEach((value,index) => assert(Math.abs(value-expected[index]) < 1e-6, `${actual} != ${expected}`));

test('Distort changes one corner independently and keeps projected lines straight', () => {
  const transform = pose();
  transform.distort[0] = [.2,.1];
  const map = Transform.surface(transform);
  near(map(0,0).slice(0,2),[.2,.1]);
  near(map(1,0).slice(0,2),[1,0]);
  near(map(0,1).slice(0,2),[0,1]);
  near(map(1,1).slice(0,2),[1,1]);
  const left=map(0,.5), right=map(1,.5), middle=map(.5,.5);
  assert(Math.abs((middle[0]-left[0])*(right[1]-left[1])-(middle[1]-left[1])*(right[0]-left[0])) < 1e-8);
  assert(Transform.valid(transform));
  assert(Transform.contains(transform,.5,.5));
  assert(!Transform.contains(transform,0,0));
  transform.distort[0] = [1,1];
  assert(!Transform.valid(transform),'a corner cannot cross the opposite corner');
});

test('Warp smoothly bends the interior while corners stay fixed, through scaling and skew', () => {
  const transform=pose();
  transform.warp[5]=[.12,-.1];
  const map=Transform.surface(transform);
  near(map(0,0).slice(0,2),[0,0]);
  near(map(1,1).slice(0,2),[1,1]);
  assert(map(1/3,1/3)[0] > 1/3);
  assert(map(1/3,1/3)[1] < 1/3);
  near(map(1/3,1/3).slice(0,2),Transform.controlPoints(transform)[5]);
  assert(Transform.valid(transform));
  const smaller={...transform,width:.6,height:.4,x:.2,y:.1,skewX:12,skewY:-5};
  const [dx,dy]=Transform.unplaceDelta(smaller,.03,-.04);
  const sx=Math.tan(smaller.skewX*Math.PI/180),sy=Math.tan(smaller.skewY*Math.PI/180);
  near([dx*smaller.width+dy*smaller.height*sx,dy*smaller.height+dx*smaller.width*sy],[.03,-.04]);
});

test('the shared mesh sampler keeps alpha and pixel colors without transparent seams', () => {
  const width=64,height=64,data=new Uint8ClampedArray(width*height*4);
  for (let i=0;i<data.length;i+=4) data.set([24,125,235,128],i);
  const source={width,height,data};
  const neutral=Transform.rasterize(source,bounds,pose(),width,height);
  assert.deepEqual(neutral.data,data,'a neutral mesh is pixel-exact');
  const transform=pose();
  transform.distort[0]=[.2,.1];
  transform.distort[1]=[-.2,.1];
  const distorted=Transform.rasterize(source,bounds,transform,width,height);
  for(let y=10;y<60;y++) for(let x=16;x<48;x++) {
    assert.deepEqual([...distorted.data.slice((y*width+x)*4,(y*width+x)*4+4)],[24,125,235,128]);
  }
  assert.equal(distorted.data[3],0);
  transform.warp[5]=[.2,-.2];
  const combined=Transform.rasterize(source,bounds,transform,width,height);
  assert.equal(combined.data[3],0);
  assert.equal(combined.data[(32*width+32)*4+3],128);
  assert.deepEqual(source.data,data,'sampling does not alter the original');
});
