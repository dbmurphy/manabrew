package forge.harness.common;

import forge.StaticData;
import forge.card.CardDb;
import forge.card.CardRules;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.Objects;

public final class CardScriptOverrides {
    private CardScriptOverrides() {
    }

    public static void apply() {
        final CardDb cards = StaticData.instance().getCommonCards();
        final String resource = "/card-overrides/flare_of_fortitude.txt";
        try (final BufferedReader reader = new BufferedReader(new InputStreamReader(
                Objects.requireNonNull(CardScriptOverrides.class.getResourceAsStream(resource), resource),
                StandardCharsets.UTF_8))) {
            final CardRules rules = CardRules.fromScript(reader.lines().toList());
            cards.getCard(rules.getName());
            cards.getEditor().putCard(rules);
        } catch (final IOException exception) {
            throw new UncheckedIOException("Unable to load card script override", exception);
        }
    }
}
