export function setupImageOverlay(): void {
  const overlay: HTMLElement | null = document.getElementById("image-overlay");
  const backdrop: HTMLElement | null = document.getElementById("image-overlay-backdrop");
  const overlayImg: HTMLImageElement | null = document.getElementById("image-overlay-img") as HTMLImageElement;
  const overlayCount: HTMLElement | null = document.getElementById("image-overlay-count");
  const closeBtn: HTMLElement | null = document.getElementById("image-overlay-close");
  const prevBtn: HTMLElement | null = document.getElementById("image-overlay-prev");
  const nextBtn: HTMLElement | null = document.getElementById("image-overlay-next");

  if (!overlay || !backdrop || !overlayImg || !overlayCount || !closeBtn || !prevBtn || !nextBtn) {
    return;
  }

  let images: string[] = [];
  let currentIndex: number = 0;

  const updateOverlay = (): void => {
    if (images.length === 0) return;
    const currentImage: string | undefined = images[currentIndex];
    if (!currentImage) return;
    overlayImg.src = currentImage;
    overlayCount.textContent = `${currentIndex + 1} / ${images.length}`;
    prevBtn.style.display = images.length > 1 ? "" : "none";
    nextBtn.style.display = images.length > 1 ? "" : "none";
  };

  const openOverlay = (imageList: string[], index: number): void => {
    images = imageList;
    currentIndex = index;
    updateOverlay();
    overlay.style.display = "";
    document.body.style.overflow = "hidden";
  };

  const closeOverlay = (): void => {
    overlay.style.display = "none";
    overlayImg.src = "";
    overlayCount.textContent = "";
    images = [];
    currentIndex = 0;
    document.body.style.overflow = "";
  };

  document.addEventListener("click", (event: MouseEvent): void => {
    const target = event.target as HTMLElement | null;
    if (!target || !target.classList.contains("event-image")) return;

    const container: HTMLElement | null = target.closest(".event-container");
    const imagesData: string | undefined = container?.dataset.images;
    if (!imagesData) return;

    try {
      const imageList: string[] = JSON.parse(imagesData);
      const indexAttr: string | null = target.getAttribute("data-image-index");
      const index: number = indexAttr ? parseInt(indexAttr, 10) : 0;
      openOverlay(imageList, Number.isNaN(index) ? 0 : index);
    } catch (e) {
      console.warn("Failed to open image overlay:", e);
    }
  });

  backdrop.addEventListener("click", closeOverlay);
  closeBtn.addEventListener("click", closeOverlay);

  prevBtn.addEventListener("click", (): void => {
    if (images.length === 0) return;
    currentIndex = (currentIndex - 1 + images.length) % images.length;
    updateOverlay();
  });

  nextBtn.addEventListener("click", (): void => {
    if (images.length === 0) return;
    currentIndex = (currentIndex + 1) % images.length;
    updateOverlay();
  });

  document.addEventListener("keydown", (event: KeyboardEvent): void => {
    if (overlay.style.display === "none") return;
    if (event.key === "Escape") {
      closeOverlay();
    } else if (event.key === "ArrowLeft") {
      prevBtn.click();
    } else if (event.key === "ArrowRight") {
      nextBtn.click();
    }
  });
}
