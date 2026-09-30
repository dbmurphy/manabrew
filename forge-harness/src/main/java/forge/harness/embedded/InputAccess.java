package forge.harness.embedded;

import java.lang.reflect.Field;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Reads the fields an Input keeps private (what it is asking for). Upstream these would be getters.
 * Every field read here must be registered in both native reflect configs.
 */
final class InputAccess {
    static final Set<String> READ = ConcurrentHashMap.newKeySet();

    private InputAccess() {
    }

    @SuppressWarnings("unchecked")
    static <T> T field(final Object input, final String name) {
        READ.add(input.getClass().getSimpleName() + "." + name);
        for (Class<?> c = input.getClass(); c != null; c = c.getSuperclass()) {
            try {
                final Field f = c.getDeclaredField(name);
                f.setAccessible(true);
                return (T) f.get(input);
            } catch (NoSuchFieldException ignored) {
                // declared higher up
            } catch (IllegalAccessException e) {
                throw new IllegalStateException(e);
            }
        }
        throw new IllegalStateException("no field " + name + " on " + input.getClass());
    }
}
