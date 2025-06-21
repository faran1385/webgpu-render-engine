@group(0) @binding(0) var<uniform> cameraPosition: vec3f;
@group(0) @binding(1) var<storage, read> offsets: array<u32>;
@group(0) @binding(2) var<storage, read> lodesData: array<f32>;
@group(0) @binding(3) var<storage, read_write> indirect: array<u32>;


@compute @workgroup_size(32)
fn cs(@builtin(global_invocation_id) id: vec3<u32>) {
    let idx = id.x;
    let offsetCount=(arrayLength(&offsets) + 1) / 2;
    if (idx >= offsetCount) { return; }

    let lodOffsetIndex=idx * 2;
    let lodesDataStart=offsets[lodOffsetIndex];
    let indirectStart=offsets[lodOffsetIndex + 1];
    let nodePosition=vec3f(lodesData[lodesDataStart],lodesData[lodesDataStart + 1],lodesData[lodesDataStart+2]);
    let lodRangesThresHold=lodesData[lodesDataStart+3];
    let lodRangesCount=lodesData[lodesDataStart+4];
    let distanceWithCamera=distance(cameraPosition , nodePosition);
    let selectedLod=clamp(0,lodRangesCount,floor(distanceWithCamera / lodRangesThresHold));
    let selectedLodBase=(selectedLod - 1) * 2;

    let indirectIndex=idx * 5;

    indirect[i32(indirectStart)]=u32(lodesData[lodesDataStart + 6 + u32(selectedLodBase)]);
    indirect[i32(indirectStart + 2)]=u32(lodesData[lodesDataStart + 5 + u32(selectedLodBase)]);
}
