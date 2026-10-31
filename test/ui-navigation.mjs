// Routing is supplied by Next in the app. DOM tests exercise the actual editor
// with a fixed route, without booting the Next router or its background tasks.
const params = new URLSearchParams();
export const useSearchParams = () => params;
export const usePathname = () => '/localization/datasets/d/records/r';
export const useRouter = () => ({push(){},replace(){}});
