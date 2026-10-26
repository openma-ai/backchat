import {describe,it,expect} from 'vitest';
import {attachmentImageSource} from './attachment-image';
import {localFileProtocolUrl} from '@shared/local-file-url';
const file={id:'photo',name:'screenshot.png',path:'/tmp/screenshot.png',uri:'file:///tmp/screenshot.png',kind:'file' as const};
describe('attachment image identification',()=>{
 it('previews image uploads even when historical kind is file',()=>expect(attachmentImageSource(file)).toBe(localFileProtocolUrl(file.path)));
 it('uses image mime metadata for extensionless files',()=>expect(attachmentImageSource({...file,name:'capture',mimeType:'image/png',data:'YWJj'})).toBe('data:image/png;base64,YWJj'));
 it('does not treat arbitrary files or SVG as raster images',()=>{expect(attachmentImageSource({...file,name:'notes.txt'})).toBeUndefined();expect(attachmentImageSource({...file,name:'image.svg',mimeType:'image/svg+xml'})).toBeUndefined();});
});
