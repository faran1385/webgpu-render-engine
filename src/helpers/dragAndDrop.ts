export function setupDragAndDrop(onFile: (file: File) => void) {
    window.addEventListener("dragover", (e) => {
        e.preventDefault(); // allow drop

        const dragover = document.querySelector(".dragover div") as HTMLDivElement | null;
        if (dragover) {
            console.log(dragover)
            dragover.classList.add("active");
        }
    });

    window.addEventListener("dragleave",()=>{
        const dragover = document.querySelector(".dragover div") as HTMLDivElement | null;
        if (dragover) {
            console.log(dragover)
            dragover.classList.remove("active");
        }
    })

    window.addEventListener("drop", (e) => {
        e.preventDefault();
        if (!e.dataTransfer) return;

        const file = e.dataTransfer.files[0];
        if (!file) return;
        const ext = file.name.split(".").pop()?.toLowerCase();
        if (ext === "glb" || ext === "gltf") {
            onFile(file);
        } else {
            alert("Only .glb or .gltf files are supported!");
        }

        const dragover = document.querySelector(".dragover div") as HTMLDivElement | null;
        if (dragover) {
            console.log(dragover)
            dragover.classList.remove("active");
        }
    });
}

export async function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });
}