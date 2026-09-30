import albumsData from "../data/albums.json";
import type { ImageMetadata } from "astro";

type ImageModule = {
  default: ImageMetadata;
};

type AlbumPhotoMetadata = {
  src: string;
  alt: string;
  title?: string;
};

type AlbumMetadata = {
  slug: string;
  title: string;
  description: string;
  photos: AlbumPhotoMetadata[];
};

export type AlbumPhoto = AlbumPhotoMetadata & {
  image: ImageMetadata;
};

export type Album = Omit<AlbumMetadata, "photos"> & {
  photos: AlbumPhoto[];
};

const imageModules = import.meta.glob<ImageModule>("../images/**/*.{webp,WebP,WEBP,jpg,JPG,jpeg,JPEG,png,PNG}", {
  eager: true
});

function resolvePhoto(photo: AlbumPhotoMetadata): AlbumPhoto {
  const imageModule = imageModules[`../images/${photo.src}`];

  if (!imageModule) {
    throw new Error(`Album photo not found: src/images/${photo.src}`);
  }

  return {
    ...photo,
    image: imageModule.default
  };
}

export const albums: Album[] = (albumsData.albums as AlbumMetadata[]).map(
  (album) => ({
    ...album,
    photos: album.photos.map(resolvePhoto)
  })
);

export function getAlbum(slug: string): Album | undefined {
  return albums.find((album) => album.slug === slug);
}
