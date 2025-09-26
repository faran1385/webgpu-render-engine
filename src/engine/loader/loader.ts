import {Accessor, Material, Mesh, Node, TypedArray, WebIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {quat, vec3} from 'gl-matrix';
import {AttributeData, LODRange} from "./loaderTypes.ts";
import {SceneObject} from "../sceneObject/sceneObject.ts";
import {Material as MaterialClass} from "../Material/Material.ts";
import {Primitive} from "../primitive/Primitive.ts";
import {Geometry} from "../geometry/Geometry.ts";
import {Scene} from "../scene/Scene.ts";
import {StandardMaterial} from "../Material/StandardMaterial.ts";
import {BaseLayer} from "../../layers/baseLayer.ts";
import {getDownloadWithPercentage} from "../../helpers/global.helper.ts";

const io = new WebIO().registerExtensions(ALL_EXTENSIONS);

/** A GLTF/GLB loader class with optional caching and progress reporting. */
export class GLTFLoader {

    /**
     * Loads a model from URL and returns document, meshes, buffers, and animations.
     */
    public async load(url: string | ArrayBuffer, scene: Scene, process: ((percentage: number) => void) | undefined = undefined, onComplete: (() => void) | undefined = undefined) {
        const data = typeof url === "string" ? await getDownloadWithPercentage(url, process) : url;
        if(onComplete) onComplete()
        let document = await io.readBinary(new Uint8Array(data));

        const root = document.getRoot();
        const sceneObjects: Set<SceneObject> = new Set();
        const nodeMap: Map<Node, SceneObject> = new Map();
        const nodeToSceneObject = new Map<Node, SceneObject>();
        const materialMap = new Map<Material | null, StandardMaterial>()
        for (const node of root.listNodes()) {
            const translation = node.getTranslation();
            const rotation = node.getRotation();
            const scale = node.getScale();
            const mesh = node.getMesh();

            const primitives = mesh ? await this.extractGeometry(mesh, materialMap) : undefined;

            const sceneObject = new SceneObject({
                name: node.getName(),
                translation: vec3.fromValues(...translation),
                rotation: quat.fromValues(...rotation),
                scale: vec3.fromValues(...scale),
                worldPosition: node.getWorldMatrix() ?? undefined,
                skin: node.getSkin() ?? undefined,
                scene
            });
            nodeMap.set(node, sceneObject);

            if (primitives) {
                primitives.forEach(([primitive, materialKey]) => {
                    const material = materialMap.get(materialKey)!
                    material.addPrimitive(primitive)
                    primitive.setMaterial(material)
                    primitive.setSceneObject(sceneObject)
                    sceneObject.appendPrimitive(primitive)
                })
            }

            nodeToSceneObject.set(node, sceneObject);
            sceneObjects.add(sceneObject);
        }
        materialMap.forEach((matClass, mat) => matClass.init(mat))
        BaseLayer.hasher.sharedTextureHashes.clear()
        for (const node of root.listNodes()) {
            const sceneObject = nodeToSceneObject.get(node);
            const parentNode = node.getParentNode();
            if (parentNode) {
                const parentSceneObject = nodeToSceneObject.get(parentNode);
                if (parentSceneObject && sceneObject) {
                    sceneObject.parent = parentSceneObject;
                    parentSceneObject.children.push(sceneObject);
                }
            }
        }

        for (const sceneObject of sceneObjects) {
            if (!sceneObject.parent) {
                sceneObject.markTransformDirty();
            }
        }
        return {
            sceneObjects,
            nodeMap,
            animations: root.listAnimations()
        };
    }


    private async extractGeometry(mesh: Mesh, materialMap: Map<Material | null, MaterialClass>): Promise<[Primitive, (Material | null)][]> {

        const primitives = mesh.listPrimitives();

        const prims: [Primitive, (Material | null)][] = [];
        for (const prim of primitives) {
            const semantics = prim.listSemantics();
            let lodRanges = undefined;
            if (prim.getExtras().lodRanges) {
                lodRanges = prim.getExtras().lodRanges as LODRange[];
            }
            const uniforms: Map<string, AttributeData> = new Map();

            prim.listAttributes().forEach((accessor: Accessor, i: number) => {
                let array = accessor.getArray() as TypedArray;
                const type = accessor.getType() as string;
                const itemSize =
                    type === 'SCALAR' ? 1 :
                        type === 'VEC2' ? 2 :
                            type === 'VEC3' ? 3 :
                                type === 'VEC4' ? 4 : array.length;
                const name = semantics[i];
                if (name === "JOINTS_0" && array instanceof Uint16Array) {
                    array = new Uint32Array(array)
                }
                uniforms.set(name, {array, itemSize});
            });
            const indexAcc = prim.getIndices();
            let indices: TypedArray | undefined = indexAcc?.getArray() ?? undefined;
            let indexType: "uint16" | "uint32" | "Unknown" =
                indices instanceof Uint16Array ? 'uint16' :
                    'uint32';
            let correctedIndices;
            if (indexType === "uint16" && indices && indices.byteLength % 4 !== 0) {
                correctedIndices = new Uint32Array(indices.length);
                correctedIndices.set(indices)
                indexType = "uint32"
            }

            const geometry = new Geometry({
                dataList: uniforms,
                indices: indices ? indices.byteLength % 4 !== 0 ? correctedIndices : indices : undefined,
                indexType,
                lodRanges: lodRanges,
                indexCount: indices?.length ?? 0,
            })
            const primitive = new Primitive();
            primitive.setGeometry(geometry)
            const alreadyExists = materialMap.get(prim.getMaterial())
            if (!alreadyExists) {
                materialMap.set(prim.getMaterial(), new StandardMaterial())
            }

            prims.push([primitive, prim.getMaterial()])
        }
        return prims;
    }
}