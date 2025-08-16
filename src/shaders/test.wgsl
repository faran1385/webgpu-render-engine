fn getNormalInfo(uv:vec2f,position:vec3f,TBN:mat3x3f,normal:vec3f) -> NormalInfo {
  var uv_dx: vec2<f32> = dpdx(uv);
  var uv_dy: vec2<f32> = dpdy(uv);
  if (length(uv_dx) <= 0.01) {
    uv_dx = vec2<f32>(1., 0.);
  }
  if (length(uv_dy) <= 0.01) {
    uv_dy = vec2<f32>(0., 1.);
  }
  let t_: vec3<f32> =     (uv_dy.y * dpdx(position) - uv_dx.y * dpdy(position)) /
  (uv_dx.x * uv_dy.y - uv_dy.x * uv_dx.y);
  var n: vec3<f32>;
  var t: vec3<f32>;
  var b: vec3<f32>;
  var ng: vec3<f32>;
  if (HAS_NORMAL_VEC3) {
    if (HAS_TANGENT_VEC4) {
      t = normalize(TBN[0]);
      b = normalize(TBN[1]);
      ng = normalize(TBN[2]);
    } else { 
      ng = normalize(normal);
      t = normalize(t_ - ng * dot(ng, t_));
      b = cross(ng, t);
    }
  } else { 
    ng = normalize(cross(dpdx(position), dpdy(position)));
    t = normalize(t_ - ng * dot(ng, t_));
    b = cross(ng, t);
  }

  if (NOT_TRIANGLE) {
    if (FRONT_FACING == false) {
      t = t * (-1.);
      b = b * (-1.);
      ng = ng * (-1.);
    }
  }

  var info: NormalInfo;
  info.ng = ng;
  if (HAS_NORMAL_MAP) {
    info.ntex = textureSample(normalTexture,normalSampler, UV).rgb * 2. - vec3<f32>(1.);
    info.ntex = info.ntex * (vec3<f32>(materialFactors.normalScale, materialFactors.normalScale, 1.));
    info.ntex = normalize(info.ntex);
    info.n = normalize(mat3x3<f32>(t, b, ng) * info.ntex);
  } else { 
    info.n = ng;
  }
  info.t = t;
  info.b = b;
  return info;
}