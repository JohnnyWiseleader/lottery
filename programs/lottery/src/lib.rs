use anchor_lang::prelude::*;

declare_id!("J5ftJMytMb7sYj4wRnv65zjumcQspuuoyuWBDLcqp57i");

#[error_code]
pub enum LotteryError {
    #[msg("Unauthorized access")]
    Unauthorized,
    
    #[msg("No funds available in escrow")]
    NoEscrowFunds,

    #[msg("No funds available in pay out")]
    NoPayoutFunds,    
}

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
    
        // Calculate holdback (10% of the ticket price)
        let holdback_amount = lottery.ticket_price / 10;
    
        // Calculate payout (90% of the ticket price)
        let payout_amount = lottery.ticket_price - holdback_amount;
    
        // Update escrow and payout fields
        lottery.escrow += holdback_amount;
        lottery.payout += payout_amount;
    
        // Deserialise ticket account
        let ticket: &mut Account<Ticket> = &mut ctx.accounts.ticket;                
    
        // Set submitter field as the address that pays for account creation
        ticket.submitter = ctx.accounts.player.key();
    
        // Set ticket index equal to the counter
        ticket.idx = lottery.count;        
    
        // Increment total submissions counter
        lottery.count += 1;                      
    
        Ok(())
    }
    
    // Oracle picks winner index
    pub fn pick_winner(ctx: Context<Winner>, winner: u32) -> Result<()> {

        // Deserialise lottery account
        let lottery: &mut Account<Lottery> = &mut ctx.accounts.lottery;
        
        // Set winning index
        lottery.winner_index = winner;                

        Ok(())
    }    

    // Payout prize to the winner
    pub fn pay_out_winner(ctx: Context<Payout>) -> Result<()> {
        let lottery: &mut Account<Lottery> = &mut ctx.accounts.lottery;
        let recipient: &mut AccountInfo = &mut ctx.accounts.winner;
    
        // Ensure payout amount is valid
        let payout_amount = lottery.payout;
        require!(payout_amount > 0, LotteryError::NoPayoutFunds);
    
        // Transfer payout amount to the winner
        **lottery.to_account_info().try_borrow_mut_lamports()? -= payout_amount;
        **recipient.to_account_info().try_borrow_mut_lamports()? += payout_amount;
    
        // Reset payout field after funds are transferred
        lottery.payout = 0;
    
        Ok(())
    }    

    // allow admin to withdraw funds from escrow
    pub fn withdraw_escrow(ctx: Context<WithdrawEscrow>) -> Result<()> {
        let lottery: &mut Account<Lottery> = &mut ctx.accounts.lottery;
        let admin: &mut Signer = &mut ctx.accounts.admin;
    
        msg!("Lottery authority: {}", lottery.authority);
        msg!("Admin signer: {}", admin.key());
    
        // Ensure only the admin can withdraw
        require_keys_eq!(lottery.admin, admin.key(), LotteryError::Unauthorized);
    
        // Get escrowed balance
        let escrow_amount = lottery.escrow;
        require!(escrow_amount > 0, LotteryError::NoEscrowFunds);
    
        // Transfer escrow funds to admin FIRST
        **lottery.to_account_info().try_borrow_mut_lamports()? -= escrow_amount;
        **admin.to_account_info().try_borrow_mut_lamports()? += escrow_amount;
    
        // Reset escrow balance AFTER withdrawal
        lottery.escrow = 0;
    
        msg!("Admin successfully withdrew {} lamports", escrow_amount);
    
        Ok(())
    }
}

// Contexts
////////////////////////////////////////////////////////////////

#[derive(Accounts)]
pub struct Create<'info> {
    #[account(init, payer = admin, space = 8 + 180)]
    pub lottery: Account<'info, Lottery>,
    #[account(mut)]
    pub admin: Signer<'info>,    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Submit<'info> {            
    #[account(init, 
        seeds = [
            &lottery.count.to_be_bytes(), 
            lottery.key().as_ref()
        ], 
        constraint = player.to_account_info().lamports() >= lottery.ticket_price,
        bump, 
        payer = player, 
        space=80
    )]
    pub ticket: Account<'info, Ticket>,        
    #[account(mut)]                                 
    pub player: Signer<'info>,                     // Payer for account creation    
    #[account(mut)]       
    pub lottery: Account<'info, Lottery>,          // To retrieve and increment counter        
    pub system_program: Program<'info, System>,    
}

#[derive(Accounts)]
pub struct Winner<'info> {    
    #[account(mut, constraint = lottery.oracle == *oracle.key)]
    pub lottery: Account<'info, Lottery>,        
    pub oracle: Signer<'info>,
}

#[derive(Accounts)]
pub struct Payout<'info> {             
    #[account(mut, 
        constraint = 
        ticket.submitter == *winner.key && 
        ticket.idx == lottery.winner_index        
    )]       
    pub lottery: Account<'info, Lottery>,          // To assert winner and withdraw lamports
    #[account(mut)]       
    /// CHECK: Not dangerous as it only receives lamports
    pub winner: AccountInfo<'info>,                // Winner account
    #[account(mut)]                  
    pub ticket: Account<'info, Ticket>,            // Winning PDA
}

#[derive(Accounts)]
pub struct WithdrawEscrow<'info> {
    #[account(mut, has_one = authority)]  
    pub lottery: Account<'info, Lottery>,
    #[account(mut, signer)]  
    pub admin: Signer<'info>,

    /// CHECK: This ensures the authority is used for verification but doesn't need to be mutable
    pub authority: AccountInfo<'info>, 
}

// Accounts
////////////////////////////////////////////////////////////////

// Lottery account 
#[account]
pub struct Lottery {    
    pub authority: Pubkey, 
    pub oracle: Pubkey, 
    pub winner: Pubkey,
    pub winner_index: u32, 
    pub count: u32,
    pub ticket_price: u64,
    pub payout: u64, // hold 90% of total in this field
    pub escrow: u64, // hold 10% of total in this field
}

// Ticket PDA
#[account]
#[derive(Default)] 
pub struct Ticket {    
    pub submitter: Pubkey,    
    pub idx: u32,
}

