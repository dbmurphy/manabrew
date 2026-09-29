use std::io::{BufRead, Write};

use manabot::{BotAgent, SimpleAi};
use manabrew_protocol::game::TargetingIntent;
use manabrew_protocol::prompts::{
    ChooseNumberOutput, ChooseObjectOutput, PromptInput, PromptOutput,
};
use manabrew_protocol::transport::{AgentPrompt, ClientToServerMessage};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut hold_attackers = false;
    let mut number_choice = None;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--hold-attackers" => hold_attackers = true,
            "--number-choice" => {
                number_choice = Some(args.next().ok_or("missing number choice")?.parse::<i32>()?)
            }
            _ => return Err(format!("unknown argument: {arg}").into()),
        }
    }
    let mut agent = SimpleAi::with_single_step_passes();
    let mut output = std::io::stdout().lock();
    for line in std::io::stdin().lock().lines() {
        let prompt: AgentPrompt = serde_json::from_str(&line?)?;
        let prompt_id = prompt.prompt_id;
        let input = prompt.input.clone();
        let action = if hold_attackers
            && matches!(&input, PromptInput::ChooseObject(choice) if choice.intent == TargetingIntent::Attack && choice.can_finish)
        {
            PromptOutput::ChooseObject(ChooseObjectOutput::Finish)
        } else if let (Some(value), PromptInput::ChooseNumber(choice)) = (number_choice, &input) {
            PromptOutput::ChooseNumber(ChooseNumberOutput::NumberDecision {
                chosen_number: Some(value.clamp(choice.min, choice.max)),
            })
        } else {
            agent.decide(prompt).ok_or("agent produced no decision")?
        };
        input
            .validate_response(&action)
            .map_err(|error| format!("invalid decision: {error:?}"))?;
        serde_json::to_writer(
            &mut output,
            &ClientToServerMessage::Response { prompt_id, action },
        )?;
        writeln!(output)?;
        output.flush()?;
    }
    Ok(())
}
