@group(0) @binding(0) var<storage, read> cameraPosition: vec3f;
@group(0) @binding(1) var<storage, read> offsets: array<f32>;
@group(0) @binding(1) var<storage, read> lodesData: array<f32>;
@group(0) @binding(1) var<storage, read_write> indirect: array<f32>;


@compute @workgroup_size(32)
fn cs(@builtin(global_invocation_id) id: vec3<u32>) {
    let idx = id.x;

    let index = idx * 6u;

}
