/* Projective corner distortion and a smooth bicubic warp, shared by preview and PNG export. */
(function (root) {
  'use strict';

  const cornerUV = [[0,0], [1,0], [0,1], [1,1]];
  function weights(t) {
    // Interpolating cubic segments keep every grip on the visible warp grid.
    const segment = Math.min(2,Math.floor(t*3)), f = t*3-segment;
    const f2=f*f, f3=f2*f, result=[0,0,0,0];
    const values=[-.5*f+f2-.5*f3, 1-2.5*f2+1.5*f3, .5*f+2*f2-1.5*f3, -.5*f2+.5*f3];
    for (let i=0;i<4;i++) result[Math.min(3,Math.max(0,segment+i-1))]+=values[i];
    return result;
  }
  const cross = (a,b,c) => (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0]);
  const hasDeformation = pose => [pose.distort,pose.warp].some(points => points?.some(point => point.some(value => Math.abs(value) > 1e-7)));

  function projection(pose) {
    const [a,b,c,d] = cornerUV.map(([x,y],index) => [x+(pose.distort?.[index]?.[0] || 0), y+(pose.distort?.[index]?.[1] || 0)]);
    const dx = a[0]-b[0]-c[0]+d[0], dy = a[1]-b[1]-c[1]+d[1];
    const x1 = b[0]-d[0], x2 = c[0]-d[0], y1 = b[1]-d[1], y2 = c[1]-d[1];
    const determinant = x1*y2-x2*y1;
    const g = (dx*y2-x2*dy) / determinant, h = (x1*dy-dx*y1) / determinant;
    const ax = b[0]-a[0]+g*b[0], bx = c[0]-a[0]+h*c[0];
    const ay = b[1]-a[1]+g*b[1], by = c[1]-a[1]+h*c[1];
    return (u,v) => {
      const q = 1 / (1+g*u+h*v);
      return [(ax*u+bx*v+a[0])*q, (ay*u+by*v+a[1])*q, q];
    };
  }
  function place(pose, u, v) {
    const sx = Math.tan(pose.skewX*Math.PI/180), sy = Math.tan(pose.skewY*Math.PI/180);
    return [pose.x+u*pose.width+(v-.5)*pose.height*sx, pose.y+v*pose.height+(u-.5)*pose.width*sy];
  }
  function unplaceDelta(pose, dx, dy) {
    const sx = Math.tan(pose.skewX*Math.PI/180), sy = Math.tan(pose.skewY*Math.PI/180);
    const determinant = 1-sx*sy;
    return [(dx-sx*dy)/determinant/pose.width, (dy-sy*dx)/determinant/pose.height];
  }
  function surface(pose) {
    const project = projection(pose);
    return (u,v) => {
      const [x,y,q] = project(u,v);
      let du = 0, dv = 0;
      if (pose.warp) {
        const wu = weights(u), wv = weights(v);
        for (let row=0; row<4; row++) for (let col=0; col<4; col++) {
          const weight = wu[col]*wv[row], point = pose.warp[row*4+col];
          du += point[0]*weight;
          dv += point[1]*weight;
        }
      }
      return [...place(pose,x+du,y+dv),u,v,q];
    };
  }
  function controlPoints(pose) {
    const project = projection(pose);
    return Array.from({length:16},(_,index) => {
      const [u,v] = project(index%4/3,Math.floor(index/4)/3);
      const [du,dv] = pose.warp?.[index] || [0,0];
      return place(pose,u+du,v+dv);
    });
  }
  function mesh(pose, divisions=24) {
    const map = surface(pose);
    return Array.from({length:(divisions+1)**2},(_,index) => map(index%(divisions+1)/divisions,Math.floor(index/(divisions+1))/divisions));
  }
  function valid(pose) {
    const divisions = 24, points = mesh(pose,divisions);
    const minimum = pose.width*pose.height/(divisions*divisions)*.01;
    if (points.some(point => point.some(value => !Number.isFinite(value)) || point[4] <= 0)) return false;
    for (let row=0; row<divisions; row++) for (let col=0; col<divisions; col++) {
      const i = row*(divisions+1)+col;
      const a = points[i], b = points[i+1], c = points[i+divisions+1], d = points[i+divisions+2];
      if (cross(a,b,d) < minimum || cross(a,d,c) < minimum) return false;
    }
    return true;
  }
  function gridLines(pose, lines=4, samples=32) {
    const map = surface(pose), paths = [];
    for (let line=0; line<lines; line++) {
      paths.push(Array.from({length:samples+1},(_,i) => map(i/samples,line/(lines-1))));
      paths.push(Array.from({length:samples+1},(_,i) => map(line/(lines-1),i/samples)));
    }
    return paths;
  }
  function contains(pose,x,y) {
    const border = gridLines(pose,2,16);
    const points = [...border[0], ...border[3], ...border[2].toReversed(), ...border[1].toReversed()];
    let inside = false;
    for (let i=0,j=points.length-1; i<points.length; j=i++) {
      const a = points[i], b = points[j];
      if ((a[1]>y)!==(b[1]>y) && x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]) inside = !inside;
    }
    return inside;
  }

  function rasterize(source, bounds, pose, width, height) {
    const output = new Uint8ClampedArray(width*height*4), pixels = source.data;
    const divisions = 32, points = mesh(pose,divisions);
    for (const point of points) { point[0] *= width; point[1] *= height; }
    function triangle(a,b,c) {
      const area = cross(a,b,c);
      if (area <= 1e-9) return;
      const left = Math.max(0,Math.ceil(Math.min(a[0],b[0],c[0])-.5));
      const right = Math.min(width-1,Math.floor(Math.max(a[0],b[0],c[0])-.5));
      const top = Math.max(0,Math.ceil(Math.min(a[1],b[1],c[1])-.5));
      const bottom = Math.min(height-1,Math.floor(Math.max(a[1],b[1],c[1])-.5));
      const stepA=(b[1]-c[1])/area, stepB=(c[1]-a[1])/area;
      for (let y=top; y<=bottom; y++) {
        let wa=((b[0]-left-.5)*(c[1]-y-.5)-(b[1]-y-.5)*(c[0]-left-.5))/area;
        let wb=((c[0]-left-.5)*(a[1]-y-.5)-(c[1]-y-.5)*(a[0]-left-.5))/area;
        for (let x=left; x<=right; x++,wa+=stepA,wb+=stepB) {
          const wc = 1-wa-wb;
          if (wa < -1e-7 || wb < -1e-7 || wc < -1e-7) continue;
          const q = wa*a[4]+wb*b[4]+wc*c[4];
          const u = (wa*a[2]*a[4]+wb*b[2]*b[4]+wc*c[2]*c[4])/q;
          const v = (wa*a[3]*a[4]+wb*b[3]*b[4]+wc*c[3]*c[4])/q;
          const sx = Math.max(0,Math.min(source.width-1,(bounds.x+u*bounds.width)*source.width-.5));
          const sy = Math.max(0,Math.min(source.height-1,(bounds.y+v*bounds.height)*source.height-.5));
          const ix = Math.floor(sx), iy = Math.floor(sy), fx = sx-ix, fy = sy-iy;
          const offset = (y*width+x)*4;
          // Interpolate premultiplied colors so transparent edges retain their color.
          const nextX=Math.min(source.width-1,ix+1), nextY=Math.min(source.height-1,iy+1);
          const p0=(iy*source.width+ix)*4, p1=(iy*source.width+nextX)*4;
          const p2=(nextY*source.width+ix)*4, p3=(nextY*source.width+nextX)*4;
          const a0=(1-fx)*(1-fy)*pixels[p0+3], a1=fx*(1-fy)*pixels[p1+3];
          const a2=(1-fx)*fy*pixels[p2+3], a3=fx*fy*pixels[p3+3];
          const alpha=a0+a1+a2+a3;
          if (alpha>0) {
            for (let channel=0;channel<3;channel++) {
              output[offset+channel]=(pixels[p0+channel]*a0+pixels[p1+channel]*a1+
                pixels[p2+channel]*a2+pixels[p3+channel]*a3)/alpha;
            }
            output[offset+3]=alpha;
          }
        }
      }
    }
    for (let row=0; row<divisions; row++) for (let col=0; col<divisions; col++) {
      const i=row*(divisions+1)+col, a=points[i], b=points[i+1], c=points[i+divisions+1], d=points[i+divisions+2];
      triangle(a,b,d); triangle(a,d,c);
    }
    return { width,height,data:output };
  }
  const api = { hasDeformation, surface, controlPoints, unplaceDelta, valid, gridLines, contains, rasterize };
  if (typeof module !== 'undefined' && module.exports) module.exports=api;
  else root.TraitTransform=api;
})(globalThis);
