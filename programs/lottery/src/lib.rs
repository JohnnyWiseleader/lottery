use anchor_lang::prelude::*;

declare_id!("J5ftJMytMb7sYj4wRnv65zjumcQspuuoyuWBDLcqp57i");

#[program]
pub mod lottery {
    use super::*;       

    // Creates an account for the lottery
    pub fn initialise_lottery(ctx: Context<Create>, ticket_price: u64, oracle_pubkey: Pubkey) -> Result<()> {        
        let lottery: &mut Account<Lottery> = &mut ctx.accounts.lottery;        
        lottery.authority = ctx.accounts.admin.key();                
        lottery.count = 0;           
        lottery.ticket_price = ticket_price;
        lottery.oracle = oracle_pubkey;

        Ok(())
    }

    // Buy a lottery ticket
    pub fn buy_ticket(ctx: Context<Submit>) -> Result<()> {
        
        // Deserialise lottery account
        let lottery: &mut Account<Lottery> = &mut ctx.accounts.lottery;          
        let player: &mut Signer = &mut ctx.accounts.player;                 

        // Transfer lamports to the lottery account
        let ix = anchor_lang::solana_program::system_instruction::transfer(
            &player.key(),
            &lottery.key(),
            lottery.ticket_price,
        );
        anchor_lang::solana_program::program::invoke(
            &ix,
            &[
                player.to_account_info(),
                lottery.to_account_info(),
            ],
        )?;

        // Deserialise ticket account
        let ticket: &mut Account<Ticket> = &mut ctx.accounts.ticket;                

        // Set submitter field as the address pays for account creation
        ticket.submitter = ctx.accounts.player.key();

        // Set ticket index equal to the counter
        ticket.idx = lottery.count;        

        // Increment total submissions counter
        lottery.count += 1;                      

        Ok(())  
    }
}

#[derive(Accounts)]
pub struct Initialize {}
