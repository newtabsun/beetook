// WebGL beauty shader for the LiveKit web beauty processor (5x5 edge-preserving blur: about half the GPU cost of the
// 7x7 preview shader, visually close because the processor renders at a capped resolution).
export const BEAUTY_VS = 'attribute vec2 p;varying vec2 uv;uniform float m;void main(){uv=vec2(m>0.5?1.0-(p.x*0.5+0.5):p.x*0.5+0.5,0.5-p.y*0.5);gl_Position=vec4(p,0.,1.);}';
export const BEAUTY_FS = `precision mediump float;varying vec2 uv;uniform sampler2D t;uniform vec2 px;uniform float sm;uniform float wh;
void main(){vec4 c=texture2D(t,uv);vec3 sum=c.rgb;float ws=1.0;
for(int i=-2;i<=2;i++)for(int j=-2;j<=2;j++){if(i==0&&j==0)continue;vec3 s=texture2D(t,uv+vec2(float(i),float(j))*px*2.5).rgb;
float w=exp(-dot(s-c.rgb,s-c.rgb)*60.0)*exp(-float(i*i+j*j)/5.0);sum+=s*w;ws+=w;}
vec3 b=sum/ws;float skin=smoothstep(0.02,0.12,c.r-c.b)*smoothstep(0.15,0.35,c.r);
vec3 o=mix(c.rgb,b,sm*mix(0.35,1.0,skin));o=mix(o,1.0-(1.0-o)*(1.0-o*0.6),wh*0.6);gl_FragColor=vec4(o,1.);}`;
