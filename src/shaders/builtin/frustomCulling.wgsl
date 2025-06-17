struct CameraStruct {
    viewProj : mat4x4<f32>
};

@group(0) @binding(0) var<storage, read> cameraPosition        : array<f32>;
@group(0) @binding(1) var<storage, read> renderAbleInfo       : array<f32>;
@group(0) @binding(2) var<storage, read> renderAbleLodRangeInfo : array<f32>;
@group(0) @binding(4) var<storage, read> maxLodDirven         : u32;
@group(0) @binding(3) var<storage, read_write> renderAbleIndirectInfo : array<u32>;
@group(0) @binding(5) var<uniform> camera               : CameraStruct;

// --- Helpers ---

// Extract the i-th *row* from a column-major mat4x4:
fn row(m: mat4x4<f32>, i: u32) -> vec4<f32> {
    return vec4<f32>(
        m[0][i],
        m[1][i],
        m[2][i],
        m[3][i]
    );
}

// Build & normalize the six frustum planes from viewProj:
fn extract_frustum_planes(M: mat4x4<f32>) -> array<vec4<f32>, 6> {
    let R0 = row(M, 0u); // row 1
    let R1 = row(M, 1u); // row 2
    let R2 = row(M, 2u); // row 3
    let R3 = row(M, 3u); // row 4

    var P: array<vec4<f32>, 6>;
    P[0] = R3 + R0; // left
    P[1] = R3 - R0; // right
    P[2] = R3 + R1; // bottom
    P[3] = R3 - R1; // top
    P[4] = R3 + R2; // near
    P[5] = R3 - R2; // far

    for (var i: u32 = 0u; i < 6u; i = i + 1u) {
        let n = P[i].xyz;
        let invLen = inverseSqrt(dot(n, n));
        P[i] = P[i] * invLen;
    }
    return P;
}

// Pick the corner farthest along normal n:
fn positive_vertex(mn: vec3<f32>, mx: vec3<f32>, n: vec3<f32>) -> vec3<f32> {
    return vec3<f32>(
        select(mn.x, mx.x, n.x > 0.0),
        select(mn.y, mx.y, n.y > 0.0),
        select(mn.z, mx.z, n.z > 0.0)
    );
}

// Test AABB against planes, return 1 = visible, 0 = culled:
fn is_visible_aabb(mn: vec3<f32>, mx: vec3<f32>, planes: array<vec4<f32>,6>) -> u32 {
    for (var i: u32 = 0u; i < 6u; i = i + 1u) {
        let pl = planes[i];
        let p  = positive_vertex(mn, mx, pl.xyz);
        if (dot(pl.xyz, p) + pl.w < 0.0) {
            return 0u;
        }
    }
    return 1u;
}

// --- Compute Shader ---

@compute @workgroup_size(32)
fn cs(@builtin(global_invocation_id) id: vec3<u32>) {
    let idx = id.x;
    if (idx > maxLodDirven) { return; }

    let base = idx * 12u;

    // --- Frustum Culling ---
    let mn = vec3<f32>(
        renderAbleInfo[base + 6u],
        renderAbleInfo[base + 7u],
        renderAbleInfo[base + 8u]
    );
    let mx = vec3<f32>(
        renderAbleInfo[base + 9u],
        renderAbleInfo[base + 10u],
        renderAbleInfo[base + 11u]
    );

    // extract & normalize planes from your combined viewProj
    let planes     = extract_frustum_planes(camera.viewProj);
    let visibility = is_visible_aabb(mn, mx, planes);

    // --- LOD & IndirectDraw Setup (unchanged) ---
    let camPos = vec3<f32>(
        cameraPosition[0],
        cameraPosition[1],
        cameraPosition[2]
    );
    let objPos   = vec3<f32>(
        renderAbleInfo[base + 0u],
        renderAbleInfo[base + 1u],
        renderAbleInfo[base + 2u]
    );
    let threshold = renderAbleInfo[base + 3u];
    let totalLods = i32(renderAbleInfo[base + 4u]);
    let lodOffset = i32(renderAbleInfo[base + 5u]);

    let dist     = distance(camPos, objPos);
    let lodIndex = clamp(i32(floor(dist / threshold)), 0, totalLods - 1);
    let rangeBase = u32(lodOffset) + u32(lodIndex) * 3u;

    let outBase = idx * 5u;
    renderAbleIndirectInfo[outBase + 0u] = u32(renderAbleLodRangeInfo[rangeBase + 0u]);
    renderAbleIndirectInfo[outBase + 1u] = visibility;
    renderAbleIndirectInfo[outBase + 2u] = u32(renderAbleLodRangeInfo[rangeBase + 1u]);
    renderAbleIndirectInfo[outBase + 3u] = u32(renderAbleLodRangeInfo[rangeBase + 2u]);
    renderAbleIndirectInfo[outBase + 4u] = 0u;
}
