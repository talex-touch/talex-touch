import type { ImageGalleryEmits, ImageGalleryItem, ImageGalleryPreviewProps, ImageGalleryProps } from './src/types'
import { withInstall } from '../../../utils/withInstall'
import TxImageGallery from './src/TxImageGallery.vue'

const ImageGallery = withInstall(TxImageGallery)

export { ImageGallery, TxImageGallery }
export type { ImageGalleryEmits, ImageGalleryItem, ImageGalleryPreviewProps, ImageGalleryProps }
export type TxImageGalleryInstance = InstanceType<typeof TxImageGallery>

export default ImageGallery
