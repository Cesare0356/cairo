#[derive(Drop, Serde)]
struct MyData {
    useraddress: starknet::EthAddress,
    value: felt252,
}

#[starknet::interface]
trait IRestaurantReview<T> {
    fn leave_review(
        ref self: T,
        user_address: starknet::EthAddress, 
        to_address: starknet::EthAddress,
        rating: felt252,
        text: Array<felt252>
    );
}

#[starknet::contract]
mod Review {
    use starknet::storage::StorageMapWriteAccess;
    use starknet::event::EventEmitter;
    use super::{IRestaurantReview, MyData};
    use starknet::{EthAddress, SyscallResultTrait};
    use core::num::traits::Zero;
    use starknet::syscalls::send_message_to_l1_syscall;
    use starknet::storage::{
        Map, StoragePathEntry, StoragePointerReadAccess, StoragePointerWriteAccess,
    };

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        ValueReceivedFromL1: ValueReceived,
    }

    #[derive(Drop, starknet::Event)]
    struct ValueReceived {
        #[key]
        l1_address: felt252,
        value: felt252
    }
    
    #[derive(Drop, Serde, starknet::Store)]
    struct ReviewData {
        ratings: felt252,
        review: felt252,
    }

    #[derive(Drop, Serde)]
    struct Result {
        user_addr: starknet::EthAddress,
        result: felt252,
    }

    #[storage]
    struct Storage {
        rev: Map<felt252, ReviewData>,
        has_review: Map<starknet::EthAddress, bool>,
        is_authorized: Map<starknet::EthAddress, bool>,
    }

    #[l1_handler]
    fn msg_handler_value(ref self: ContractState, from_address: felt252, data: MyData) {
        // Reject empty or invalid data received from L1.
        assert(!data.value.is_zero(), 'Dato non valido');

        let l1_address: felt252 = data.useraddress.into();

        // Authorization logic can be enabled here if needed.
        // self.is_authorized.write(data.useraddress, true);

        self.emit(ValueReceived {
            l1_address,
            value: data.value,
        });
    }

    #[abi(embed_v0)]
    impl ReviewImpl of IRestaurantReview<ContractState> {
        fn leave_review(
            ref self: ContractState,
            user_address: EthAddress,
            to_address: EthAddress,
            rating: felt252,
            text: Array<felt252>
        ) { 
            // Authorization check can be enabled here if required.
            // let is_authorized: bool = self.is_authorized.entry(user_address).read();
            // if (!is_authorized) {
            //     assert(is_authorized, 'Utente non autorizzato');
            //     return;
            // }

            let res: Result = Result {
                user_addr: user_address,
                result: 1,
            };

            // Check whether the user has already submitted a review.
            let already: bool = self.has_review.entry(user_address).read();

            if(already) {
                let resnorev: Result = Result {
                    user_addr: user_address,
                    result: 0,
                };

                let mut buf: Array<felt252> = array![];
                resnorev.serialize(ref buf);

                // self.is_authorized.write(user_address, false);

                send_message_to_l1_syscall(to_address.into(), buf.span()).unwrap_syscall();
                return;
            }

            let caller: felt252 = to_address.into();
            
            // Convert and validate the rating.
            let rating_u8: u8 = rating.try_into().unwrap();

            assert(rating_u8 >= 1, 'Rating troppo basso');
            assert(rating_u8 <= 5, 'Rating troppo alto');

            // Validate review length.
            let review_len = text.len();
            assert(review_len > 3, 'Review troppo corta');
            assert(review_len < 1024, 'Review troppo lunga');
        
            // Validate that each character is printable ASCII.
            let mut i = 0;
            while i != review_len {
                let c: felt252 = text.at(i).clone();
                let c_u8: u8 = c.try_into().unwrap();

                assert(c_u8 >= 32, 'Carattere non valido');
                assert(c_u8 <= 126, 'Carattere non valido');

                i += 1;
            };

            // Store the review data.
            self.rev.write(caller, ReviewData {
                ratings: rating,
                review: pack_short_string(text.clone()),
            });

            let mut buf: Array<felt252> = array![];
            res.serialize(ref buf);

            // self.is_authorized.write(user_address, false);

            self.has_review.entry(user_address).write(true);

            // Notify L1 about the review result.
            send_message_to_l1_syscall(to_address.into(), buf.span()).unwrap_syscall();
        }
    }

    fn pack_short_string(mut text_array: Array<felt252>) -> felt252 {
        // Pack the review text into a single felt252 value.
        assert(text_array.len() <= 1024, 'Stringa troppo lunga');

        let mut packed_value: felt252 = 0;
        let shift_factor: felt252 = 256;

        loop {
            match text_array.pop_front() {
                Option::Some(char) => {
                    packed_value = packed_value * shift_factor;
                    packed_value = packed_value + char;
                },
                Option::None => {
                    break;
                }
            };
        };

        packed_value
    }
}