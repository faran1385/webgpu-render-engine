@group(0) @binding(0) var<uniform> frustumPlanes: array<vec4<f32>, 6>;
@group(0) @binding(1) var<storage, read> aabbData: array<f32>;
@group(0) @binding(2) var<storage, read> indirectStarts: array<u32>;
@group(0) @binding(3) var<storage, read_write> indirect: array<u32>;

fn positive_vertex(min: vec3f, max: vec3f, normal: vec3f) -> vec3f {
    return vec3f(
        select(min.x, max.x, normal.x > 0.0),
        select(min.y, max.y, normal.y > 0.0),
        select(min.z, max.z, normal.z > 0.0)
    );
}

fn is_visible(min: vec3f, max: vec3f) -> u32 {
    for (var i: u32 = 0u; i < 6u; i = i + 1u) {
        let pl = frustumPlanes[i];
        let n = pl.xyz;
        let d = pl.w;
        let p = positive_vertex(min, max, n);
        if (dot(n, p) + d < 0.0) {
            return 0u; // culled
        }
    }
    return 1u; // visible
}

@compute @workgroup_size(64)
fn cs(@builtin(global_invocation_id) id: vec3<u32>) {
    let idx = id.x;
    let frustumCullingItemsCount=arrayLength(&indirectStarts);

    if (idx >= frustumCullingItemsCount) {
        return;
    }

    let i6 = idx * 6u;
    let min = vec3f(
        aabbData[i6 + 0u],
        aabbData[i6 + 1u],
        aabbData[i6 + 2u]
    );
    let max = vec3f(
        aabbData[i6 + 3u],
        aabbData[i6 + 4u],
        aabbData[i6 + 5u]
    );

    let visibility = is_visible(min, max);
    let indirectStart = indirectStarts[idx];


    indirect[indirectStart + 1] = visibility;
}
